import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { eq, sql } from 'drizzle-orm';
import { db, nfseInvoices, nfseEvents } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';
import { resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';

export const nfseRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/nfse ───────────────────────────────────────────────────── */
  fastify.get('/nfse', async (request, reply) => {
    const { tenant_id, status, client_id, page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const { rows } = await db.execute<any>(sql`
      SELECT n.*,
             COALESCE(c.company_name, c.full_name) AS client_name
      FROM nfse_invoices n
      LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.tenant_id = ${tenant_id}
        ${status    ? sql`AND n.nfse_status = ${status}`         : sql``}
        ${client_id ? sql`AND n.client_id = ${client_id}::uuid` : sql``}
      ORDER BY n.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const { rows: [{ total }] } = await db.execute<{ total: number }>(sql`
      SELECT COUNT(*)::int AS total FROM nfse_invoices
      WHERE tenant_id = ${tenant_id}
        ${status    ? sql`AND nfse_status = ${status}`         : sql``}
        ${client_id ? sql`AND client_id = ${client_id}::uuid` : sql``}
    `);

    return { data: rows, total, page: Number(page), per_page: limit };
  });

  /* ── GET /v1/nfse/:id ───────────────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/nfse/:id', async (request, reply) => {
    const { id } = request.params;
    const { tenant_id } = request.query as { tenant_id: string };
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const { rows } = await db.execute<any>(sql`
      SELECT n.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM nfse_invoices n
      LEFT JOIN clients c ON c.id = n.client_id
      WHERE n.id = ${id} AND n.tenant_id = ${tenant_id}
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
  fastify.get<{ Params: { id: string } }>('/nfse/:id/events', async (request, reply) => {
    const { id } = request.params;
    const rows = await db.select({
      event_type: nfseEvents.event_type, status_code: nfseEvents.status_code,
      protocol: nfseEvents.protocol, payload: nfseEvents.payload, created_at: nfseEvents.created_at,
    }).from(nfseEvents).where(eq(nfseEvents.nfse_id, id))
      .orderBy(sql`${nfseEvents.created_at} DESC`);
    return rows;
  });

  /* ── POST /v1/nfse/:id/emit ─────────────────────────────────────────── */
  // Re-emit a rejected (or never-sent) NFS-e.
  fastify.post<{ Params: { id: string } }>('/nfse/:id/emit', async (request, reply) => {
    const { id } = request.params;
    const { tenant_id } = request.query as { tenant_id: string };
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
    if (!queueUrl) return reply.badRequest('Emissão de NFS-e não configurada neste ambiente');

    const [nfse] = await db.select().from(nfseInvoices)
      .where(sql`${nfseInvoices.id} = ${id} AND ${nfseInvoices.tenant_id} = ${tenant_id}`);
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
      cfg = await resolveCompanyId(tenant_id, nfse.company_id, db, 'nfse');
    } catch (err) {
      const msg = err instanceof CompanyDomainError ? companyResolutionErrorMessage(err, 'NFS-e') : 'Configure os dados fiscais em Empresa → NF-e/NFS-e antes de emitir';
      return reply.badRequest(msg);
    }
    if (!cfg.inscricao_municipal)
      return reply.badRequest('Inscrição Municipal é obrigatória para emitir NFS-e');

    if (!nfse.client_id) return reply.badRequest('NFS-e sem cliente vinculado');
    const { rows: cRows } = await db.execute<any>(sql`SELECT * FROM clients WHERE id = ${nfse.client_id}`);
    const clientRow = cRows[0];
    if (!clientRow) return reply.badRequest('Cliente da NFS-e não encontrado');

    await db.update(nfseInvoices)
      .set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1`, nfse_reject_reason: null })
      .where(eq(nfseInvoices.id, id));

    const message = buildNfseEmitMessage({
      nfse_id:      nfse.id,
      tenant_id,
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
