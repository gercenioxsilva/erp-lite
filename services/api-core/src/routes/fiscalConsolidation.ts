// Consolidação — /v1/fiscal/consolidation/*. Regras parametrizáveis, drafts
// (lista/detalhe/calcular/emitir/reenviar) e o ciclo agendado (alvo do
// EventBridge 23:59) com isolamento por-draft.

import { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, consolidationRules } from '../db';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { ConsolidationDomainError, STRATEGIES } from '../domain/consolidation/consolidationDomain';
import { CompanyDomainError, resolveCompanyId } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';
import {
  consolidateMatched, calculateDraft, emitDraft, runScheduled, listDrafts, getDraft,
} from '../services/consolidationService';

export const fiscalConsolidationRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof ConsolidationDomainError || err instanceof FiscalDomainError || err instanceof SimplesDomainError) {
      if (err.code.endsWith('_not_found')) return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
    throw err;
  }

  /* ── Regras ─────────────────────────────────────────────────────────── */

  fastify.get('/fiscal/consolidation/rules', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await db.select().from(consolidationRules).where(eq(consolidationRules.tenant_id, tenantId)) };
  });

  fastify.post('/fiscal/consolidation/rules', guard('fiscal:consolidate'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as any;
    if (!b?.strategy || !STRATEGIES.includes(b.strategy)) {
      return reply.badRequest(`strategy inválida. Valores: ${STRATEGIES.join(', ')}`);
    }
    try {
      const company = await resolveCompanyId(tenantId, b.company_id, db);
      const [row] = await db.insert(consolidationRules).values({
        tenant_id: tenantId, company_id: company.id,
        client_id: b.client_id ?? null, contract_id: b.contract_id ?? null,
        strategy: b.strategy, service_code: b.service_code ?? null, created_by: userId,
      }).returning();
      return reply.code(201).send(row);
    } catch (err) { return handleError(err, reply); }
  });

  fastify.delete('/fiscal/consolidation/rules/:id', guard('fiscal:consolidate'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const [row] = await db.update(consolidationRules).set({ is_active: false })
      .where(and(eq(consolidationRules.id, id), eq(consolidationRules.tenant_id, tenantId))).returning();
    if (!row) return reply.notFound('Regra não encontrada');
    return reply.code(204).send();
  });

  /* ── Drafts ─────────────────────────────────────────────────────────── */

  fastify.get('/fiscal/consolidation/drafts', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { status?: string; competency?: string };
    return { data: await listDrafts(tenantId, q) };
  });

  fastify.get('/fiscal/consolidation/drafts/:id', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await getDraft(tenantId, id); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/consolidation/drafts/:id/calculate', guard('fiscal:consolidate'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await calculateDraft(tenantId, id, userId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/consolidation/drafts/:id/emit', guard('fiscal:emit'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await emitDraft(tenantId, id, userId); }
    catch (err) { return handleError(err, reply); }
  });

  /* ── Ciclos ─────────────────────────────────────────────────────────── */

  fastify.post('/fiscal/consolidation/run', guard('fiscal:consolidate'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    try { return await consolidateMatched(tenantId, {}); }
    catch (err) { return handleError(err, reply); }
  });

  // Alvo do EventBridge 23:59 (America/Sao_Paulo). Isolamento por-draft:
  // erro em 1 nota não interrompe as outras (relatório em errors[]).
  fastify.post('/fiscal/consolidation/run-scheduled', guard('fiscal:emit'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    try { return await runScheduled(tenantId); }
    catch (err) { return handleError(err, reply); }
  });
};
