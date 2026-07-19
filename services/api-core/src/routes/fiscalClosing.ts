// Fechamento de competência — /v1/fiscal/closing*. FECHAR (checklist) ≠
// TRAVAR (ação separada); reabrir exige reason e permissão dedicada
// fiscal:reopen (fora do Gestor, mesma trava de manage_certificate).

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';
import {
  closeCompetencia, lockCompetencia, unlockCompetencia, getClosingStatus, listLocks, FiscalLockError,
} from '../services/fiscalClosingService';

export const fiscalClosingRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof FiscalLockError) {
      if (err.code === 'closing_already_running') return reply.code(409).send({ error: err.code, ...err.payload });
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof FiscalDomainError || err instanceof SimplesDomainError) {
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.post('/fiscal/close-competencia', guard('fiscal:close'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { company_id?: string; competencia?: string };
    if (!b?.competencia) return reply.badRequest('competencia é obrigatória (YYYY-MM)');
    try { return reply.code(201).send(await closeCompetencia(tenantId, b.company_id, b.competencia, userId)); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/closing', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string; competencia?: string };
    if (!q.competencia) return reply.badRequest('competencia é obrigatória');
    try { return await getClosingStatus(tenantId, q.company_id, q.competencia); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/period-locks', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await listLocks(tenantId) };
  });

  fastify.post('/fiscal/period-locks/:competencia/lock', guard('fiscal:close'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { competencia } = request.params as { competencia: string };
    const b = (request.body ?? {}) as { company_id?: string };
    try { await lockCompetencia(tenantId, b.company_id, competencia, userId); return { ok: true, locked: competencia }; }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/period-locks/:competencia/unlock', guard('fiscal:reopen'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { competencia } = request.params as { competencia: string };
    const b = (request.body ?? {}) as { company_id?: string; reason?: string };
    if (!b.reason) return reply.badRequest('reason é obrigatório para reabrir competência');
    try { await unlockCompetencia(tenantId, b.company_id, competencia, b.reason, userId); return { ok: true, unlocked: competencia }; }
    catch (err) { return handleError(err, reply); }
  });
};
