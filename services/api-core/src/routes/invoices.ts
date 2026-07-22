import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { and, eq, sql } from 'drizzle-orm';
import { db, invoices, invoiceItems, orders, nfeEvents, nfeCorrectionLetters } from '../db';
import { applyEntry } from '../services/costCenterStock';
import { cancelCommission } from '../services/commissionService';
import { resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';
import { requirePermission } from '../lib/requirePermission';
import { getSqsClient } from '../lib/sqsClient';
import { validateJustificativa, requiresFiscalCancellation, NfeCancellationDomainError } from '../domain/nfeCancellation/nfeCancellationDomain';
import { validateCorrectionText, canIssueCorrection, nextSequence, NfeCorrectionDomainError } from '../domain/nfeCorrection/nfeCorrectionDomain';

interface InvoiceItemPayload {
  material_id?: string; name: string; ncm_code?: string; cfop?: string;
  quantity: number; unit_price: number;
  icms_cst?: string; icms_base?: number; icms_rate?: number; icms_value?: number;
  pis_cst?:  string; pis_base?:  number; pis_rate?:  number; pis_value?:  number;
  cofins_cst?: string; cofins_base?: number; cofins_rate?: number; cofins_value?: number;
  ipi_rate?: number; ipi_value?: number;
  fcp_rate?: number; fcp_value?: number; icms_difal_value?: number;
  // Reforma Tributária — IBS/CBS (regra 44)
  class_trib?: string;
  ibs_base?: number; ibs_rate?: number; ibs_value?: number;
  cbs_base?: number; cbs_rate?: number; cbs_value?: number;
}

export const invoicesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/invoices ───────────────────────────────────────────────── */
  fastify.get('/invoices', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    // tenant_id ainda é aceito na query por retrocompatibilidade de contrato,
    // mas nunca é lido — o tenant vem sempre do JWT (request.user.tenantId).
    const { status, search, nfe_status, client_id,
            issue_date_from, issue_date_to, total_min, total_max,
            page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status && status !== 'all' ? sql`AND i.status = ${status}` : sql``;
    const searchFilter = search
      ? sql`AND (i.number ILIKE ${'%' + search + '%'} OR COALESCE(c.company_name, c.full_name) ILIKE ${'%' + search + '%'})`
      : sql``;
    // 'none' = sem status SEFAZ (rascunhos ainda não enviados)
    const nfeStatusFilter = nfe_status
      ? (nfe_status === 'none' ? sql`AND i.nfe_status IS NULL` : sql`AND i.nfe_status = ${nfe_status}`)
      : sql``;
    const clientFilter   = client_id       ? sql`AND i.client_id = ${client_id}::uuid`        : sql``;
    const dateFromFilter = issue_date_from ? sql`AND i.issue_date >= ${issue_date_from}::date` : sql``;
    const dateToFilter   = issue_date_to   ? sql`AND i.issue_date <= ${issue_date_to}::date`   : sql``;
    const totalMinFilter = total_min       ? sql`AND i.total >= ${total_min}`                  : sql``;
    const totalMaxFilter = total_max       ? sql`AND i.total <= ${total_max}`                  : sql``;

    const filters = sql`${statusFilter} ${searchFilter} ${nfeStatusFilter} ${clientFilter} ${dateFromFilter} ${dateToFilter} ${totalMinFilter} ${totalMaxFilter}`;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT i.id, i.number, i.serie, i.status, i.issue_date,
               i.subtotal, i.total, i.notes, i.order_id, i.created_at,
               i.nfe_status, i.nfe_chave, i.nfe_reject_reason, i.cost_center_id, i.seller_id,
               COALESCE(c.company_name, c.full_name) AS client_name,
               o.number AS order_number
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        LEFT JOIN orders o ON o.id = i.order_id
        WHERE i.tenant_id = ${tenantId} ${filters}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM invoices i
        JOIN clients c ON c.id = i.client_id
        WHERE i.tenant_id = ${tenantId} ${filters}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/invoices ──────────────────────────────────────────────── */
  fastify.post('/invoices', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const body = request.body as any;
    // tenant_id ainda é aceito no body por retrocompatibilidade de contrato,
    // mas nunca é lido — o tenant vem sempre do JWT (request.user.tenantId).
    const { client_id, order_id, items, notes, serie = '1',
            tax_regime = 'lucro_presumido', origin_state = 'SP', cost_center_id, seller_id, company_id, payment_plan_id } = body;
    if (!client_id) return reply.badRequest('client_id is required');
    if (!Array.isArray(items) || !items.length) return reply.badRequest('At least one item is required');

    // company_id (regra 40) é opcional na criação — quando informado, precisa
    // pertencer ao tenant e estar ativo. Quando omitido, fica null e a emissão
    // resolve para a empresa padrão do tenant (mesmo comportamento de antes
    // para quem nunca configurou multi-empresa).
    let resolvedCompanyId: string | null = null;
    if (company_id) {
      try {
        const company = await resolveCompanyId(tenantId, company_id);
        resolvedCompanyId = company.id;
      } catch (err) {
        if (err instanceof CompanyDomainError) return reply.badRequest('Empresa (company_id) inválida para este tenant');
        throw err;
      }
    }

    // Herda vendedor e centro de custo do pedido de origem quando não
    // informados explicitamente — mesma lógica pros dois, um único SELECT
    // (regra 61: antes só o vendedor herdava; centro de custo nunca herdou,
    // o que também quebrava a baixa de estoque na autorização, gated em
    // invoices.cost_center_id).
    let resolvedSellerId:     string | null = seller_id      || null;
    let resolvedCostCenterId: string | null = cost_center_id || null;
    // Plano de Pagamento (regra 75) segue o mesmo racional: herda do pedido
    // de origem quando a nota não escolhe um explicitamente — é a fonte de
    // verdade lida por routes/nfe.ts/nfeResultsWorker.ts pra gerar as
    // parcelas de receivables e o quadro de duplicatas da NF-e.
    let resolvedPaymentPlanId: string | null = payment_plan_id || null;
    if ((!resolvedSellerId || !resolvedCostCenterId || !resolvedPaymentPlanId) && order_id) {
      const [ord] = await db.select({
        seller_id: orders.seller_id, cost_center_id: orders.cost_center_id, payment_plan_id: orders.payment_plan_id,
      }).from(orders).where(eq(orders.id, order_id));
      resolvedSellerId      = resolvedSellerId      ?? ord?.seller_id       ?? null;
      resolvedCostCenterId  = resolvedCostCenterId  ?? ord?.cost_center_id  ?? null;
      resolvedPaymentPlanId = resolvedPaymentPlanId ?? ord?.payment_plan_id ?? null;
    }

    const n = (v: unknown) => Number(v) || 0;
    const subtotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.quantity) * n(it.unit_price), 0);
    const icmsTotal   = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.icms_value), 0);
    const fcpTotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.fcp_value), 0);
    const difalTotal  = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.icms_difal_value), 0);
    const pisTotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.pis_value),  0);
    const cofinsTotal = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.cofins_value), 0);
    const ipiTotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.ipi_value),  0);
    // Reforma Tributária — informativos, nunca somados em `taxTotal`/`total` (regra 44).
    const ibsTotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.ibs_value), 0);
    const cbsTotal    = items.reduce((s: number, it: InvoiceItemPayload) => s + n(it.cbs_value), 0);
    const taxTotal    = Math.round((icmsTotal + fcpTotal + difalTotal + pisTotal + cofinsTotal) * 100) / 100;
    const total       = Math.round((subtotal + ipiTotal) * 100) / 100;

    const invoice = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(invoices).values({
        tenant_id: tenantId, client_id, order_id: order_id || null, serie,
        company_id: resolvedCompanyId,
        notes: notes || null,
        subtotal: String(subtotal), tax_total: String(taxTotal), total: String(total),
        status: 'draft',
        tax_regime, origin_state,
        icms_total: String(icmsTotal), pis_total: String(pisTotal), cofins_total: String(cofinsTotal),
        fcp_total: String(fcpTotal), icms_difal_total: String(difalTotal),
        ibs_total: String(ibsTotal), cbs_total: String(cbsTotal),
        cost_center_id: resolvedCostCenterId,
        seller_id: resolvedSellerId,
        payment_plan_id: resolvedPaymentPlanId,
      }).returning({ id: invoices.id, status: invoices.status, serie: invoices.serie });

      for (const it of items as InvoiceItemPayload[]) {
        await tx.insert(invoiceItems).values({
          invoice_id: inv.id, material_id: it.material_id || null,
          name: it.name, ncm_code: it.ncm_code || null, cfop: it.cfop || null,
          quantity: String(it.quantity), unit_price: String(it.unit_price),
          total: String(n(it.quantity) * n(it.unit_price)),
          icms_cst: it.icms_cst || null, icms_base: String(it.icms_base ?? 0),
          icms_rate: String(it.icms_rate ?? 0), icms_value: String(it.icms_value ?? 0),
          pis_cst: it.pis_cst || null, pis_base: String(it.pis_base ?? 0),
          pis_rate: String(it.pis_rate ?? 0), pis_value: String(it.pis_value ?? 0),
          cofins_cst: it.cofins_cst || null, cofins_base: String(it.cofins_base ?? 0),
          cofins_rate: String(it.cofins_rate ?? 0), cofins_value: String(it.cofins_value ?? 0),
          ipi_rate: String(it.ipi_rate ?? 0), ipi_value: String(it.ipi_value ?? 0),
          fcp_rate: String(it.fcp_rate ?? 0), fcp_value: String(it.fcp_value ?? 0),
          icms_difal_value: String(it.icms_difal_value ?? 0),
          class_trib: it.class_trib || null,
          ibs_base: String(it.ibs_base ?? 0), ibs_rate: String(it.ibs_rate ?? 0), ibs_value: String(it.ibs_value ?? 0),
          cbs_base: String(it.cbs_base ?? 0), cbs_rate: String(it.cbs_rate ?? 0), cbs_value: String(it.cbs_value ?? 0),
        } as any);
      }

      if (order_id) {
        await tx.execute(sql`
          UPDATE orders SET status = 'invoiced'
          WHERE id = ${order_id} AND status IN ('confirmed', 'draft')
        `);
      }
      return inv;
    });

    return reply.code(201).send(invoice);
  });

  /* ── GET /v1/invoices/:id ───────────────────────────────────────────── */
  fastify.get('/invoices/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const [{ rows: [invoice] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT i.*, COALESCE(c.company_name, c.full_name) AS client_name,
               c.cnpj, c.cpf, c.person_type, o.number AS order_number
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        LEFT JOIN orders o ON o.id = i.order_id
        WHERE i.id = ${id} AND i.tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`SELECT * FROM invoice_items WHERE invoice_id = ${id} ORDER BY created_at`),
    ]);
    if (!invoice) return reply.notFound('Nota fiscal não encontrada');
    return { ...invoice, items };
  });

  /* ── POST /v1/invoices/:id/cancel ───────────────────────────────────── */
  fastify.post('/invoices/:id/cancel', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:cancel')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    // request.body vem undefined quando a requisição não manda payload
    // nenhum (ex.: cancelamento de nota nunca autorizada, sem justificativa)
    // — nunca desestruturar direto, senão quebra com 500 em vez do 422 normal.
    const { justificativa } = (request.body ?? {}) as { justificativa?: string };
    const [invoice] = await db.select({
      id:             invoices.id,
      order_id:       invoices.order_id,
      status:         invoices.status,
      nfe_status:     invoices.nfe_status,
      cost_center_id: invoices.cost_center_id,
      tenant_id:      invoices.tenant_id,
      company_id:     invoices.company_id,
    }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenant_id, tenantId)));
    if (!invoice)                       return reply.notFound('Nota fiscal não encontrada');
    if (invoice.status === 'cancelled') return reply.badRequest('Nota já cancelada');

    // Só nota AUTORIZADA precisa (e pode) ser cancelada junto à SEFAZ — exige
    // justificativa (≥15 chars, regra SEFAZ). Nota que nunca chegou a ser
    // autorizada (draft/rejeitada/em processamento) segue o cancelamento
    // local de sempre, sem tocar em nfe_status.
    const wasAuthorized = requiresFiscalCancellation(invoice.nfe_status);
    if (wasAuthorized) {
      try {
        validateJustificativa(justificativa);
      } catch (err) {
        if (err instanceof NfeCancellationDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
        throw err;
      }
    }

    await db.transaction(async (tx) => {
      await tx.update(invoices).set({
        status: 'cancelled',
        // Estende a mesma máquina de estados de nfe_status (nunca um campo
        // paralelo) — 'cancel_pending' até o worker confirmar o cancelamento
        // junto ao Focus/SEFAZ.
        ...(wasAuthorized ? { nfe_status: 'cancel_pending', nfe_cancel_reason: justificativa!.trim() } : {}),
      }).where(and(eq(invoices.id, id), eq(invoices.tenant_id, tenantId)));
      if (invoice.order_id) {
        await tx.execute(sql`
          UPDATE orders SET status = 'confirmed'
          WHERE id = ${invoice.order_id} AND status = 'invoiced'
            AND NOT EXISTS (
              SELECT 1 FROM invoices
              WHERE order_id = ${invoice.order_id} AND status = 'issued' AND id != ${id}
            )
        `);
      }
    });

    // ── Stock IN estorno (fire-and-forget, idempotent) ───────────────────────
    if (wasAuthorized && invoice.cost_center_id && invoice.tenant_id) {
      try {
        const { rows: items } = await db.execute<{
          material_id: string | null;
          quantity: string;
          unit_price: string;
        }>(sql`SELECT material_id, quantity, unit_price FROM invoice_items WHERE invoice_id = ${id}`);

        for (const item of items) {
          if (!item.material_id) continue;
          await applyEntry({
            tenantId:     invoice.tenant_id,
            costCenterId: invoice.cost_center_id,
            materialId:   item.material_id,
            quantity:     Number(item.quantity),
            unitCost:     Number(item.unit_price),
            source:       'adjustment',
            sourceId:     `cancel:${id}`,
            note:         `Estorno cancelamento NF-e ${id}`,
          }, db);
        }
      } catch (stockErr) {
        console.error(JSON.stringify({ event: 'stock_estorno_error', invoice_id: id, error: String(stockErr) }));
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Commission cancellation (fire-and-forget, idempotent) ────────────────
    // Sem efeito se a nota não tinha vendedor atribuído ou comissão já cancelada.
    if (wasAuthorized && invoice.tenant_id) {
      try {
        await cancelCommission({ tenantId: invoice.tenant_id, invoiceId: id }, db);
      } catch (commErr) {
        console.error(JSON.stringify({ event: 'commission_cancel_error', invoice_id: id, error: String(commErr) }));
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Cancelamento fiscal junto à SEFAZ (assíncrono, mesma fila de emissão) ──
    if (wasAuthorized) {
      try {
        const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
        if (!queueUrl) throw new Error('NFE_REQUESTS_QUEUE_URL não configurada');

        const cfg = await resolveCompanyId(tenantId, invoice.company_id, db, 'nfe');
        const focusToken = cfg.focus_ambiente === 1
          ? (cfg.focus_token_producao    ?? undefined)
          : (cfg.focus_token_homologacao ?? undefined);

        const message = {
          type: 'nfe_cancel' as const,
          invoice_id: id, tenant_id: tenantId, focus_ref: id,
          ambiente: cfg.focus_ambiente as 1 | 2, focus_token: focusToken,
          justificativa: justificativa!.trim(),
        };
        await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
      } catch (err) {
        // Não conseguiu nem enfileirar — reverte nfe_status pra não deixar a
        // nota presa em cancel_pending sem ninguém processando (mesmo
        // princípio de tolerância a falha de routes/nfe.ts). O cancelamento
        // LOCAL (status/estoque/comissão) já aconteceu e não é desfeito.
        await db.update(invoices).set({ nfe_status: 'authorized' })
          .where(and(eq(invoices.id, id), eq(invoices.tenant_id, tenantId), eq(invoices.nfe_status, 'cancel_pending')));
        await db.insert(nfeEvents).values({
          invoice_id: id, tenant_id: tenantId, event_type: 'cancellation_enqueue_failed',
          payload: { reason: String(err) },
        });
        console.error(JSON.stringify({ event: 'nfe_cancel_enqueue_error', invoice_id: id, error: String(err) }));
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return { ok: true, status: 'cancelled' };
  });

  /* ── POST /v1/invoices/:id/cce — Carta de Correção Eletrônica ──────────── */
  fastify.post('/invoices/:id/cce', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:correct')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const { correction_text } = (request.body ?? {}) as { correction_text?: string };

    try {
      validateCorrectionText(correction_text);
    } catch (err) {
      if (err instanceof NfeCorrectionDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
      throw err;
    }

    const [invoice] = await db.select({
      id: invoices.id, nfe_status: invoices.nfe_status, company_id: invoices.company_id,
    }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenant_id, tenantId)));
    if (!invoice) return reply.notFound('Nota fiscal não encontrada');
    if (!canIssueCorrection(invoice.nfe_status))
      return reply.code(422).send({ error: 'nfe_correction_requires_authorized', nfe_status: invoice.nfe_status });

    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (!queueUrl) return reply.badRequest('Carta de correção não configurada neste ambiente');

    let cfg;
    try {
      cfg = await resolveCompanyId(tenantId, invoice.company_id, db, 'nfe');
    } catch (err) {
      const msg = err instanceof CompanyDomainError ? companyResolutionErrorMessage(err, 'NF-e') : 'Configure os dados fiscais em Empresa → Fiscal antes de emitir carta de correção';
      return reply.badRequest(msg);
    }
    const focusToken = cfg.focus_ambiente === 1
      ? (cfg.focus_token_producao    ?? undefined)
      : (cfg.focus_token_homologacao ?? undefined);

    const { rows: seqRows } = await db.execute<{ sequencia: number }>(
      sql`SELECT sequencia FROM nfe_correction_letters WHERE invoice_id = ${id}`,
    );
    const sequencia = nextSequence(seqRows.map(r => Number(r.sequencia)));
    const trimmedText = correction_text!.trim();

    const [row] = await db.insert(nfeCorrectionLetters).values({
      invoice_id: id, tenant_id: tenantId, sequencia, correction_text: trimmedText, status: 'pending',
    }).returning();

    const message = {
      type: 'cce' as const,
      invoice_id: id, tenant_id: tenantId, focus_ref: id,
      ambiente: cfg.focus_ambiente as 1 | 2, focus_token: focusToken,
      sequencia, correction_text: trimmedText,
    };

    try {
      await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    } catch (err) {
      // Não conseguiu nem enfileirar — remove a linha recém-criada pra a
      // sequência ficar livre pra um retry limpo (mesmo racional de
      // routes/nfe.ts quando o send falha).
      await db.delete(nfeCorrectionLetters).where(eq(nfeCorrectionLetters.id, row.id));
      throw err;
    }

    return reply.code(202).send({ ok: true, id: row.id, sequencia, status: 'pending' });
  });

  /* ── GET /v1/invoices/:id/cce — lista as cartas de correção da nota ────── */
  fastify.get('/invoices/:id/cce', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('invoices:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    const rows = await db.select({
      id: nfeCorrectionLetters.id, sequencia: nfeCorrectionLetters.sequencia,
      correction_text: nfeCorrectionLetters.correction_text, status: nfeCorrectionLetters.status,
      protocol: nfeCorrectionLetters.protocol, reject_reason: nfeCorrectionLetters.reject_reason,
      pdf_s3_key: nfeCorrectionLetters.pdf_s3_key, created_at: nfeCorrectionLetters.created_at,
    }).from(nfeCorrectionLetters)
      .where(and(eq(nfeCorrectionLetters.invoice_id, id), eq(nfeCorrectionLetters.tenant_id, tenantId)))
      .orderBy(sql`${nfeCorrectionLetters.sequencia} ASC`);

    return { data: rows };
  });
};
