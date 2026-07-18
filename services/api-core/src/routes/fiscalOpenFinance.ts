// Open Finance (Pluggy) — /v1/fiscal/openfinance/*. Gating em camadas padrão
// (authenticate → requireModule('fiscal') → requirePermission). Conectar/
// desconectar exige bank_accounts:manage (credencial bancária — owner/admin,
// mesma trava das contas bancárias); sincronizar é operação (fiscal:import).

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError, companyResolutionErrorMessage } from '../services/companyService';
import {
  connectToken, registerConnection, listConnections, disconnect, syncConnection,
  OpenFinanceError,
} from '../services/openFinanceService';

export const fiscalOpenFinanceRoutes: FastifyPluginAsync = async (fastify) => {
  const guard = (perm: string) => ({
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('fiscal'), requirePermission(perm)],
  });

  const handleError = (err: unknown, reply: any) => {
    if (err instanceof OpenFinanceError) {
      const status = err.code === 'openfinance_disabled' ? 503
        : err.code === 'connection_not_found' ? 404 : 422;
      return reply.code(status).send({ error: err.code, ...err.payload });
    }
    if (err instanceof CompanyDomainError) {
      return reply.badRequest(companyResolutionErrorMessage(err, 'Open Finance'));
    }
    throw err;
  };

  fastify.get('/fiscal/openfinance/connections', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await listConnections(tenantId) };
  });

  fastify.post('/fiscal/openfinance/connect-token', guard('bank_accounts:manage'), async (request, reply) => {
    try {
      return { data: await connectToken() };
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/openfinance/connections', guard('bank_accounts:manage'), async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { item_id?: string; company_id?: string };
    try {
      const conn = await registerConnection(tenantId, b?.company_id ?? null, b?.item_id ?? '', userId ?? null);
      return reply.code(201).send({ data: conn });
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/fiscal/openfinance/connections/:id/sync', guard('fiscal:import'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return { data: await syncConnection(tenantId, id) };
    } catch (err) { return handleError(err, reply); }
  });

  fastify.delete('/fiscal/openfinance/connections/:id', guard('bank_accounts:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return { data: await disconnect(tenantId, id) };
    } catch (err) { return handleError(err, reply); }
  });
};
