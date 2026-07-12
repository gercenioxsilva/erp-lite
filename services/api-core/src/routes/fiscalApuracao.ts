// Apuração PGDAS-D — /v1/fiscal/apuracao*. Apurar/reapurar competência,
// memória de cálculo, export/roteiro assistido (SEM transmissão — portal
// GOV.BR é manual), pagamento de DAS e estimado-vs-pago para o dashboard.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError, resolveCompanyId } from '../services/companyService';
import { FiscalDomainError } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';
import { db } from '../db';
import {
  apurarCompetencia, exportApuracao, listApuracoes, registerDasPayment, estimadoVsPago,
} from '../services/apuracaoService';

export const fiscalApuracaoRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof SimplesDomainError || err instanceof FiscalDomainError) {
      if (err.code.endsWith('_not_found')) return reply.notFound(err.code);
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) {
      if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  fastify.get('/fiscal/apuracao', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { company_id?: string };
    try {
      const companyId = q.company_id ? (await resolveCompanyId(tenantId, q.company_id, db)).id : null;
      return { data: await listApuracoes(tenantId, companyId) };
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/apuracao', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { company_id?: string; competencia?: string };
    if (!b?.competencia) return reply.badRequest('competencia é obrigatória (YYYY-MM)');
    try {
      return reply.code(201).send(await apurarCompetencia(tenantId, b.company_id ?? '', b.competencia, userId));
    } catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/apuracao/:id/export', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await exportApuracao(tenantId, id, userId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/das-payments', guard('fiscal:apurar'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { company_id?: string; competencia?: string; paid_at?: string; amount?: number; reference?: string };
    if (!b?.competencia || !b?.paid_at || !b?.amount) {
      return reply.badRequest('competencia, paid_at e amount são obrigatórios');
    }
    try {
      const company = await resolveCompanyId(tenantId, b.company_id, db);
      return reply.code(201).send(await registerDasPayment(tenantId, {
        companyId: company.id, competencia: b.competencia, paidAt: b.paid_at,
        amount: b.amount, reference: b.reference,
      }, userId));
    } catch (err) { return handleError(err, reply); }
  });

  fastify.get('/fiscal/das-summary', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await estimadoVsPago(tenantId) };
  });
};
