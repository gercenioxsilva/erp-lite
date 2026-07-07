import { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, invoices, invoiceItems, receivables, orders } from '../db';
import { applyEntry } from '../services/costCenterStock';
import { cancelCommission } from '../services/commissionService';
import { resolveCompanyId, CompanyDomainError } from '../services/companyService';

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
  fastify.get('/invoices', async (request, reply) => {
    const { tenant_id, status, search, nfe_status, client_id,
            issue_date_from, issue_date_to, total_min, total_max,
            page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

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
        WHERE i.tenant_id = ${tenant_id} ${filters}
        ORDER BY i.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM invoices i
        JOIN clients c ON c.id = i.client_id
        WHERE i.tenant_id = ${tenant_id} ${filters}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/invoices ──────────────────────────────────────────────── */
  fastify.post('/invoices', async (request, reply) => {
    const body = request.body as any;
    const { tenant_id, client_id, order_id, items, notes, serie = '1',
            tax_regime = 'lucro_presumido', origin_state = 'SP', cost_center_id, seller_id, company_id } = body;
    if (!tenant_id || !client_id) return reply.badRequest('tenant_id and client_id are required');
    if (!Array.isArray(items) || !items.length) return reply.badRequest('At least one item is required');

    // company_id (regra 40) é opcional na criação — quando informado, precisa
    // pertencer ao tenant e estar ativo. Quando omitido, fica null e a emissão
    // resolve para a empresa padrão do tenant (mesmo comportamento de antes
    // para quem nunca configurou multi-empresa).
    let resolvedCompanyId: string | null = null;
    if (company_id) {
      try {
        const company = await resolveCompanyId(tenant_id, company_id);
        resolvedCompanyId = company.id;
      } catch (err) {
        if (err instanceof CompanyDomainError) return reply.badRequest('Empresa (company_id) inválida para este tenant');
        throw err;
      }
    }

    // Herda o vendedor do pedido de origem quando não informado explicitamente
    let resolvedSellerId: string | null = seller_id || null;
    if (!resolvedSellerId && order_id) {
      const [ord] = await db.select({ seller_id: orders.seller_id }).from(orders).where(eq(orders.id, order_id));
      resolvedSellerId = ord?.seller_id ?? null;
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
        tenant_id, client_id, order_id: order_id || null, serie,
        company_id: resolvedCompanyId,
        notes: notes || null,
        subtotal: String(subtotal), tax_total: String(taxTotal), total: String(total),
        status: 'draft',
        tax_regime, origin_state,
        icms_total: String(icmsTotal), pis_total: String(pisTotal), cofins_total: String(cofinsTotal),
        fcp_total: String(fcpTotal), icms_difal_total: String(difalTotal),
        ibs_total: String(ibsTotal), cbs_total: String(cbsTotal),
        cost_center_id: cost_center_id || null,
        seller_id: resolvedSellerId,
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
  fastify.get('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [{ rows: [invoice] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT i.*, COALESCE(c.company_name, c.full_name) AS client_name,
               c.cnpj, c.cpf, c.person_type, o.number AS order_number
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        LEFT JOIN orders o ON o.id = i.order_id
        WHERE i.id = ${id}
      `),
      db.execute<any>(sql`SELECT * FROM invoice_items WHERE invoice_id = ${id} ORDER BY created_at`),
    ]);
    if (!invoice) return reply.notFound('Nota fiscal não encontrada');
    return { ...invoice, items };
  });

  /* ── POST /v1/invoices/:id/issue ────────────────────────────────────── */
  fastify.post('/invoices/:id/issue', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [invoice] = await db.select({
      id: invoices.id, tenant_id: invoices.tenant_id,
      client_id: invoices.client_id, serie: invoices.serie,
      status: invoices.status, total: invoices.total,
    }).from(invoices).where(eq(invoices.id, id));
    if (!invoice)                   return reply.notFound('Nota fiscal não encontrada');
    if (invoice.status !== 'draft') return reply.badRequest('Apenas rascunhos podem ser emitidos');

    const { rows: [num] } = await db.execute<{ n: string }>(sql`
      SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INTEGER END), 0) + 1 AS n
      FROM invoices WHERE tenant_id = ${invoice.tenant_id} AND serie = ${invoice.serie} AND status = 'issued'
    `);

    const number    = String(num.n).padStart(6, '0');
    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      await tx.update(invoices)
        .set({ status: 'issued', number, issue_date: issueDate })
        .where(eq(invoices.id, id));

      await tx.insert(receivables).values({
        tenant_id:   invoice.tenant_id,
        client_id:   invoice.client_id,
        invoice_id:  invoice.id,
        description: `NF-e nº ${number} (série ${invoice.serie})`,
        amount:      String(invoice.total),
        due_date:    dueDate,
        status:      'pending',
      });
    });

    return { ok: true, status: 'issued', number };
  });

  /* ── POST /v1/invoices/:id/cancel ───────────────────────────────────── */
  fastify.post('/invoices/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [invoice] = await db.select({
      id:             invoices.id,
      order_id:       invoices.order_id,
      status:         invoices.status,
      nfe_status:     invoices.nfe_status,
      cost_center_id: invoices.cost_center_id,
      tenant_id:      invoices.tenant_id,
    }).from(invoices).where(eq(invoices.id, id));
    if (!invoice)                       return reply.notFound('Nota fiscal não encontrada');
    if (invoice.status === 'cancelled') return reply.badRequest('Nota já cancelada');

    const wasAuthorized = invoice.nfe_status === 'authorized';

    await db.transaction(async (tx) => {
      await tx.update(invoices).set({ status: 'cancelled' }).where(eq(invoices.id, id));
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

    return { ok: true, status: 'cancelled' };
  });
};
