import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { and, eq, sql } from 'drizzle-orm';
import { db, nfseInvoices, nfseEvents } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';
import { resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';
import { createStandaloneNfse, NfseDomainError } from '../services/nfseService';
import { requirePermission } from '../lib/requirePermission';

function nfseDomainErrorMessage(err: NfseDomainError): string {
  switch (err.code) {
    case 'nfse_client_not_found':             return 'Cliente não encontrado';
    case 'nfse_client_required':               return 'Cliente é obrigatório';
    case 'nfse_description_required':          return 'Descrição é obrigatória';
    case 'nfse_amount_invalid':                return 'Valor deve ser maior que zero';
    case 'nfse_service_code_required':         return 'Código de serviço (LC 116) é obrigatório — configure em Empresa → NF-e/NFS-e ou informe manualmente';
    case 'nfse_iss_rate_invalid':              return 'Alíquota de ISS inválida';
    case 'nfse_missing_inscricao_municipal':   return 'Inscrição Municipal é obrigatória para emitir NFS-e';
    default:                                   return 'Não foi possível criar a NFS-e';
  }
}

export const nfseRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/nfse ───────────────────────────────────────────────────── */
  fastify.get('/nfse', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { status, client_id, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const { rows } = await db.execute<any>(sql`
      SELECT n.*,
             COALESCE(c.company_name, c.full_name) AS client_name
      FROM nfse_invoices n
      LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.tenant_id = ${tenantId}
        ${status    ? sql`AND n.nfse_status = ${status}`         : sql``}
        ${client_id ? sql`AND n.client_id = ${client_id}::uuid` : sql``}
      ORDER BY n.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const { rows: [{ total }] } = await db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM nfse_invoices
      WHERE tenant_id = ${tenantId}
        ${status    ? sql`AND nfse_status = ${status}`         : sql``}
        ${client_id ? sql`AND client_id = ${client_id}::uuid` : sql``}
    `);

    return { data: rows, total, page: Number(page), per_page: limit };
  });

  /* ── POST /v1/nfse ──────────────────────────────────────────────────── */
  // NFS-e avulsa: emissão direta de serviço, sem passar pelo faturamento de
  // Ordem de Serviço (regra 47) nem por Contrato de Serviço — mesma UX de
  // "nota fiscal de venda avulsa" (POST /v1/invoices). Cria o rascunho; a
  // emissão em si é o POST /:id/emit acima, reaproveitado sem duplicar.
  fastify.post('/nfse', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as any;

    if (!b.client_id)                    return reply.badRequest('client_id é obrigatório');
    if (!b.description?.trim())          return reply.badRequest('description é obrigatório');
    if (!(Number(b.amount) > 0))         return reply.badRequest('amount deve ser maior que zero');

    try {
      const nfse = await createStandaloneNfse({
        tenantId,
        clientId:    b.client_id,
        description: b.description,
        amount:      Number(b.amount),
        serviceCode: b.service_code || null,
        issRate:     b.iss_rate != null ? Number(b.iss_rate) : null,
        periodStart: b.period_start || null,
        periodEnd:   b.period_end   || null,
        companyId:   b.company_id   || null,
      }, db);
      return reply.code(201).send(nfse);
    } catch (err) {
      if (err instanceof CompanyDomainError) return reply.badRequest(companyResolutionErrorMessage(err, 'NFS-e'));
      if (err instanceof NfseDomainError)     return reply.badRequest(nfseDomainErrorMessage(err));
      throw err;
    }
  });

  /* ── GET /v1/nfse/:id ───────────────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/nfse/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;

    const { rows } = await db.execute<any>(sql`
      SELECT n.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM nfse_invoices n
      LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.id = ${id} AND n.tenant_id = ${tenantId}
    `);
    if (!rows[0]) return reply.notFound('NFS-e não encontrada');

    const events = await db.select({
      event_type: nfseEvents.event_type, status_code: nfseEvents.status_code,
      protocol: nfseEvents.protocol, payload: nfseEvents.payload, created_at: nfseEvents.created_at,
    }).from(nfseEvents).where(eq(nfseEvents.nfse_id, id))
      .orderBy(sql`${nfseEvents.created_at} DESC`);

    return { ...rows[0], events };
  });

  /* ── GET /v1/nfse/:id/events ────────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/nfse/:id/events', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;
    const rows = await db.select({
      event_type: nfseEvents.event_type, status_code: nfseEvents.status_code,
      protocol: nfseEvents.protocol, payload: nfseEvents.payload, created_at: nfseEvents.created_at,
    }).from(nfseEvents).where(and(eq(nfseEvents.nfse_id, id), eq(nfseEvents.tenant_id, tenantId)))
      .orderBy(sql`${nfseEvents.created_at} DESC`);
    return rows;
  });

  /* ── POST /v1/nfse/:id/emit ─────────────────────────────────────────── */
  // Re-emit a rejected (or never-sent) NFS-e.
  fastify.post<{ Params: { id: string } }>('/nfse/:id/emit', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:emit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params;

    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (!queueUrl) return reply.badRequest('Emissão de NFS-e não configurada neste ambiente');

    const [nfse] = await db.select().from(nfseInvoices)
      .where(sql`${nfseInvoices.id} = ${id} AND ${nfseInvoices.tenant_id} = ${tenantId}`);
    if (!nfse) return reply.notFound('NFS-e não encontrada');

    if (nfse.nfse_status === 'pending' || nfse.nfse_status === 'processing')
      return reply.badRequest('Esta NFS-e já está sendo processada. Aguarde o resultado.');
    if (nfse.nfse_status === 'authorized')
      return reply.badRequest('Esta NFS-e já foi autorizada.');

    // Resolve qual empresa/CNPJ emite esta NFS-e (regra 40/53) — nfse.company_id
    // quando definido, senão a empresa padrão do tenant, restrito a empresas
    // com emite_nfse=true.
    let cfg;
    try {
      cfg = await resolveCompanyId(tenantId, nfse.company_id, db, 'nfse');
    } catch (err) {
      const msg = err instanceof CompanyDomainError ? companyResolutionErrorMessage(err, 'NFS-e') : 'Configure os dados fiscais em Empresa → NF-e/NFS-e antes de emitir';
      return reply.badRequest(msg);
    }
    if (!cfg.inscricao_municipal)
      return reply.badRequest('Inscrição Municipal é obrigatória para emitir NFS-e');
    // Trava de segurança: produção exige o token do próprio tenant (não cair
    // no fallback do token mestre da plataforma em lambda-fiscal) — sem isso,
    // a mensagem sai sem focus_token, o Lambda usa o token mestre (que não
    // tem permissão pra emitir em nome do CNPJ do tenant) e o Focus rejeita
    // com "permissao_negada: CNPJ do emitente não autorizado". Mesma trava
    // já existia em routes/nfe.ts, faltava aqui.
    if (cfg.focus_ambiente === 1 && !cfg.focus_token_producao)
      return reply.badRequest('Configure o token de Produção em Empresa → Fiscal antes de emitir em produção.');

    if (!nfse.client_id) return reply.badRequest('NFS-e sem cliente vinculado');
    const { rows: cRows } = await db.execute<any>(sql`SELECT * FROM clients WHERE id = ${nfse.client_id}`);
    const clientRow = cRows[0];
    if (!clientRow) return reply.badRequest('Cliente da NFS-e não encontrado');

    await db.update(nfseInvoices)
      .set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1`, nfse_reject_reason: null })
      .where(eq(nfseInvoices.id, id));

    const message = buildNfseEmitMessage({
      nfse_id:      nfse.id,
      tenant_id:    tenantId,
      description:  nfse.description,
      amount:       Number(nfse.amount),
      iss_rate:     Number(nfse.iss_rate),
      iss_value:    Number(nfse.iss_value),
      service_code: nfse.service_code,
      period_start: nfse.period_start,
      period_end:   nfse.period_end,
      cfg,
      client:       clientRow,
    });

    try {
      await getSqsClient().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    } catch (err) {
      await db.update(nfseInvoices).set({ nfse_status: nfse.nfse_status ?? null }).where(eq(nfseInvoices.id, id));
      throw err;
    }

    await db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, id));

    return reply.code(202).send({
      ok: true, nfse_status: 'processing',
      message: 'NFS-e enviada para processamento. Acompanhe o status em tempo real.',
    });
  });
};
