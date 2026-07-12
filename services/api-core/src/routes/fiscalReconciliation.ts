// Conciliação — /v1/fiscal/reconciliation/*. Fila "Pendente de Conciliação",
// candidatos ranqueados, confirmação manual 1↔1, ignore e run on-demand.

import { FastifyPluginAsync } from 'fastify';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { db, importedTransactions, reconciliationRules, nfseMunicipalities } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { resolveCompanyId } from '../services/companyService';
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

  /* ── Regras de conciliação (CRUD, tenant-scoped) ──────────────────────── */
  // Antes só existiam via SQL. Sem regra ativa vale o DEFAULT (0.01/3d/0.90/net).
  fastify.get('/fiscal/reconciliation/rules', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const rows = await db.select().from(reconciliationRules)
      .where(and(eq(reconciliationRules.tenant_id, tenantId), eq(reconciliationRules.is_active, true)));
    return { data: rows };
  });

  fastify.post('/fiscal/reconciliation/rules', guard('fiscal:reconcile'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = request.body as {
      company_id?: string; amount_tolerance?: number; date_window_days?: number;
      auto_confirm_threshold?: number; match_net_amount?: boolean;
    };
    const companyId = b.company_id ? (await resolveCompanyId(tenantId, b.company_id, db)).id : null;
    const [row] = await db.insert(reconciliationRules).values({
      tenant_id: tenantId, company_id: companyId,
      amount_tolerance: b.amount_tolerance != null ? String(b.amount_tolerance) : undefined,
      date_window_days: b.date_window_days ?? undefined,
      auto_confirm_threshold: b.auto_confirm_threshold != null ? String(b.auto_confirm_threshold) : undefined,
      match_net_amount: b.match_net_amount ?? undefined,
    }).returning();
    return reply.code(201).send(row);
  });

  fastify.put('/fiscal/reconciliation/rules/:id', guard('fiscal:reconcile'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (b.amount_tolerance != null) patch.amount_tolerance = String(b.amount_tolerance);
    if (b.date_window_days != null) patch.date_window_days = b.date_window_days;
    if (b.auto_confirm_threshold != null) patch.auto_confirm_threshold = String(b.auto_confirm_threshold);
    if (b.match_net_amount != null) patch.match_net_amount = b.match_net_amount;
    const [row] = await db.update(reconciliationRules).set(patch)
      .where(and(eq(reconciliationRules.id, id), eq(reconciliationRules.tenant_id, tenantId))).returning();
    if (!row) return reply.notFound('Regra não encontrada');
    return row;
  });

  fastify.delete('/fiscal/reconciliation/rules/:id', guard('fiscal:reconcile'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const [row] = await db.update(reconciliationRules).set({ is_active: false, updated_at: new Date() })
      .where(and(eq(reconciliationRules.id, id), eq(reconciliationRules.tenant_id, tenantId))).returning();
    if (!row) return reply.notFound('Regra não encontrada');
    return reply.code(204).send();
  });

  /* ── Registro de municípios NFS-e (GLOBAL — leitura livre, escrita owner/admin) ── */
  // ⚠ Tabela global (sem tenant_id): editar afeta TODOS os tenants. Por isso a
  // escrita fica restrita a owner/admin; a leitura é liberada para visibilidade.
  const requireOwnerAdmin = (request: any, reply: any): boolean => {
    const role = request.user?.role;
    if (role !== 'owner' && role !== 'admin') {
      reply.code(403).send({ error: 'municipality_write_forbidden', hint: 'registro global — só owner/admin editam' });
      return false;
    }
    return true;
  };

  fastify.get('/fiscal/nfse-municipalities', guard('fiscal:view'), async () => {
    const rows = await db.select().from(nfseMunicipalities).orderBy(asc(nfseMunicipalities.nome));
    return { data: rows };
  });

  fastify.post('/fiscal/nfse-municipalities', guard('fiscal:config'), async (request, reply) => {
    if (!requireOwnerAdmin(request, reply)) return;
    const b = request.body as any;
    if (!b?.codigo_ibge || !b?.uf || !b?.nome || !b?.provider) {
      return reply.badRequest('codigo_ibge, uf, nome e provider são obrigatórios');
    }
    const [row] = await db.insert(nfseMunicipalities).values({
      codigo_ibge: b.codigo_ibge, uf: b.uf, nome: b.nome, provider: b.provider,
      abrasf_versao: b.abrasf_versao ?? null, perfil: b.perfil ?? null,
      endpoint_homolog: b.endpoint_homolog ?? null, endpoint_producao: b.endpoint_producao ?? null,
      signature_algo: b.signature_algo ?? undefined, c14n: b.c14n ?? undefined,
      lote_assincrono: b.lote_assincrono ?? undefined, ativo: b.ativo ?? undefined, notes: b.notes ?? null,
    }).onConflictDoUpdate({
      target: nfseMunicipalities.codigo_ibge,
      set: {
        uf: b.uf, nome: b.nome, provider: b.provider, abrasf_versao: b.abrasf_versao ?? null,
        perfil: b.perfil ?? null, endpoint_homolog: b.endpoint_homolog ?? null,
        endpoint_producao: b.endpoint_producao ?? null, notes: b.notes ?? null,
      },
    }).returning();
    return reply.code(201).send(row);
  });

  fastify.delete('/fiscal/nfse-municipalities/:codigoIbge', guard('fiscal:config'), async (request, reply) => {
    if (!requireOwnerAdmin(request, reply)) return;
    const { codigoIbge } = request.params as { codigoIbge: string };
    const [row] = await db.update(nfseMunicipalities).set({ ativo: false })
      .where(eq(nfseMunicipalities.codigo_ibge, codigoIbge)).returning();
    if (!row) return reply.notFound('Município não encontrado');
    return reply.code(204).send();
  });
};
