// Simulador de DAS em tempo real — /v1/fiscal/simulator*. Stateless: nada
// persiste; todo número sai do MESMO motor da apuração (apurarSimples).

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';
import { getProjecao, simularWhatIf } from '../services/simuladorService';

export const fiscalSimulatorRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = {
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission('fiscal:view')],
  };

  function handleError(err: unknown, reply: any) {
    if (err instanceof SimplesDomainError || err instanceof FiscalDomainError) {
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.get('/fiscal/simulator', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string };
    try { return await getProjecao(tenantId, q.company_id); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/simulator/what-if', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = (request.body ?? {}) as any;
    if (b.cenarios && !Array.isArray(b.cenarios)) return reply.badRequest('cenarios deve ser um array');
    try { return await simularWhatIf(tenantId, b.company_id, b); }
    catch (err) { return handleError(err, reply); }
  });
};
