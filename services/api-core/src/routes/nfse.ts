import { FastifyPluginAsync } from 'fastify';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { and, eq, sql } from 'drizzle-orm';
import { db, nfseInvoices, nfseEvents } from '../db';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';
import { resolveCompanyId, companyResolutionErrorMessage, CompanyDomainError } from '../services/companyService';
import { requirePermission } from '../lib/requirePermission';
import { enqueueAbrasfCancel, enqueueAbrasfEmission } from '../services/nfseProviderService';
import { getOrCreateConfig } from '../services/fiscalCompanyConfigService';
import { createAndEmitNfse, NfseCreateError } from '../services/nfseCreateService';
import { FiscalLockError } from '../services/fiscalPeriodLockGuard';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';

export const nfseRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── POST /v1/nfse ──────────────────────────────────────────────────── */
  // Emissão avulsa: cria + emite numa tacada. É o alvo do "Aceitar" do
  // rascunho proposto pelo assistente IA (o modelo nunca chama isto).
  fastify.post('/nfse', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:emit')] }, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as {
      client_id?: string; amount?: number; description?: string; service_code?: string;
      iss_rate?: number; iss_retido?: boolean; company_id?: string; due_date?: string; idempotency_key?: string;
    };
    if (!b?.client_id || !b?.description || b?.amount == null) {
      return reply.badRequest('client_id, description e amount são obrigatórios');
    }
    try {
      const result = await createAndEmitNfse(tenantId, {
        clientId: b.client_id, amount: Number(b.amount), description: b.description,
        serviceCode: b.service_code ?? null, issRate: b.iss_rate ?? null, issRetido: b.iss_retido,
        companyId: b.company_id ?? null, dueDate: b.due_date ?? null, idempotencyKey: b.idempotency_key ?? null,
      }, userId);
      return reply.code(result.duplicate ? 200 : 201).send({ ok: true, ...result });
    } catch (err) {
      if (err instanceof NfseCreateError) return reply.code(422).send({ error: err.code, ...err.payload });
      if (err instanceof FiscalLockError) return reply.code(422).send({ error: err.code, ...err.payload });
      if (err instanceof CompanyDomainError) {
        return reply.badRequest(companyResolutionErrorMessage(err, 'NFS-e'));
      }
      throw err;
    }
  });

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

    // Provider próprio (ABRASF): reemitir tem de seguir o MESMO motor da 1ª
    // emissão (assina no api-core, série/RPS própria). Sem este branch a
    // reemissão de uma empresa abrasf sairia pela conta Focus global, com a
    // linha ainda marcada provider:'abrasf' — e um cancelamento futuro assinaria
    // ABRASF para uma nota que o Focus autorizou. enqueueAbrasfEmission faz o
    // próprio incremento de status/nfse_attempts, então retornamos antes do
    // caminho Focus (evita o duplo incremento).
    const fiscalConfig = await getOrCreateConfig(tenantId, cfg.id, db);
    if (fiscalConfig.nfse_provider === 'abrasf') {
      try {
        const res = await enqueueAbrasfEmission(tenantId, id, db);
        return reply.code(202).send({
          ok: true,
          nfse_status: res.enqueued ? 'processing' : 'pending',
          message: 'NFS-e enviada para processamento. Acompanhe o status em tempo real.',
        });
      } catch (err) {
        if (err instanceof FiscalDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
        throw err;
      }
    }
    if (fiscalConfig.nfse_provider !== 'focus') {
      return reply.badRequest(`Reemissão não suportada para o provider '${fiscalConfig.nfse_provider}'.`);
    }

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

  /* ── POST /v1/nfse/:id/cancel ───────────────────────────────────────── */
  // Cancelamento via adapter próprio (motor 0074): assina o
  // InfPedidoCancelamento no api-core e enfileira action:'cancel'.
  fastify.post('/nfse/:id/cancel', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('nfse:cancel')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params as { id: string };
    const body     = request.body as { reason?: string };
    if (!body?.reason) return reply.badRequest('reason é obrigatório');

    try {
      const result = await enqueueAbrasfCancel(tenantId, id, body.reason, userId);
      return reply.code(202).send({ ok: true, ...result });
    } catch (err) {
      if (err instanceof FiscalDomainError) {
        if (err.code === 'nfse_not_found') return reply.notFound('NFS-e não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });
};
