// Conciliação — /v1/fiscal/reconciliation/*. Fila "Pendente de Conciliação",
// candidatos ranqueados, confirmação manual 1↔1, ignore e run on-demand.

import { FastifyPluginAsync } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { db, importedTransactions } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { ReconciliationDomainError } from '../domain/reconciliation/reconciliationDomain';
import {
  runReconciliation, confirmMatchManual, ignoreTransaction,
  listCandidatesFor, reconciliationSummary,
} from '../services/reconciliationService';

export const fiscalReconciliationRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof ReconciliationDomainError) {
      if (err.code.endsWith('_not_found')) return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  // Fila "Pendente de Conciliação" (+ filtro por status).
  fastify.get('/fiscal/reconciliation/transactions', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { status?: string };
    const statuses = q.status ? q.status.split(',') : ['pending', 'unmatched'];
    const rows = await db.select().from(importedTransactions)
      .where(and(eq(importedTransactions.tenant_id, tenantId), inArray(importedTransactions.reconciliation_status, statuses)))
      .limit(200);
    return { data: rows };
  });

  fastify.get('/fiscal/reconciliation/transactions/:id/candidates', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return { data: await listCandidatesFor(tenantId, id) }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/reconciliation/transactions/:id/match', guard('fiscal:reconcile'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { receivable_id?: string };
    if (!body?.receivable_id) return reply.badRequest('receivable_id é obrigatório');
    try { return reply.code(201).send(await confirmMatchManual(tenantId, id, body.receivable_id, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/reconciliation/transactions/:id/ignore', guard('fiscal:reconcile'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { await ignoreTransaction(tenantId, id, userId); return { ok: true }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/reconciliation/run', guard('fiscal:reconcile'), async (request) => {
    const { tenantId } = (request as any).user;
    const body = (request.body ?? {}) as { company_id?: string };
    return runReconciliation(tenantId, { companyId: body.company_id });
  });

  fastify.get('/fiscal/reconciliation/summary', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return reconciliationSummary(tenantId);
  });
};
