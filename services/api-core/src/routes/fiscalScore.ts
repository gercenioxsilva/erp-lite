// Score Fiscal + inconsistências — /v1/fiscal/score e /v1/fiscal/inconsistencies.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { computeScore } from '../services/fiscalScoreService';
import { detectInconsistencies } from '../services/fiscalInconsistencyService';

export const fiscalScoreRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = {
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission('fiscal:view')],
  };

  function handleError(err: unknown, reply: any) {
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.get('/fiscal/score', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string };
    try { return await computeScore(tenantId, q.company_id); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/inconsistencies', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string; competencia?: string };
    try { return { data: await detectInconsistencies(tenantId, q.company_id, q.competencia ?? null) }; }
    catch (err) { return handleError(err, reply); }
  });
};
