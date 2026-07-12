// Central de alertas — /v1/fiscal/alerts*. Badge do sino usa /summary
// (índice parcial status='open'); ack/resolve sob fiscal:acknowledge.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import {
  listAlerts, countOpenAlerts, setAlertStatus, evaluateAndPersist, AlertError,
} from '../services/fiscalAlertService';

export const fiscalAlertsRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = (permission: string) => ({
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(permission)],
  });

  function handleError(err: unknown, reply: any) {
    if (err instanceof AlertError) {
      if (err.code === 'alert_not_found') return reply.notFound('Alerta não encontrado');
      return reply.code(422).send({ error: err.code });
    }
    if (err instanceof CompanyDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
    throw err;
  }

  fastify.get('/fiscal/alerts', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { status?: string; severity?: string; limit?: string };
    return { data: await listAlerts(tenantId, { status: q.status, severity: q.severity, limit: Number(q.limit) || 100 }) };
  });

  fastify.get('/fiscal/alerts/summary', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return countOpenAlerts(tenantId);
  });

  fastify.post('/fiscal/alerts/:id/acknowledge', guard('fiscal:acknowledge'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await setAlertStatus(tenantId, id, 'acknowledge', userId); }
    catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/alerts/:id/resolve', guard('fiscal:acknowledge'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    try { return await setAlertStatus(tenantId, id, 'resolve', userId); }
    catch (err) { return handleError(err, reply); }
  });

  // Reavaliação on-demand — MESMA função usada pelo worker e pelo fechamento.
  fastify.post('/fiscal/alerts/evaluate', guard('fiscal:view'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = (request.body ?? {}) as { company_id?: string };
    try { return await evaluateAndPersist(tenantId, b.company_id); }
    catch (err) { return handleError(err, reply); }
  });
};
