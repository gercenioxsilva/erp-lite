// Open Finance (Pluggy) — /v1/fiscal/openfinance/*. Gating em camadas padrão
// (authenticate → requireModule('fiscal') → requirePermission). Conectar/
// desconectar exige bank_accounts:manage (credencial bancária — owner/admin,
// mesma trava das contas bancárias); sincronizar é operação (fiscal:import).

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { IntegrationServiceDisabledError } from '../services/integrations/integrationService';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError, companyResolutionErrorMessage } from '../services/companyService';
import {
  connectToken, registerConnection, listConnections, disconnect, syncConnection,
  cashPosition, OpenFinanceError,
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
      // Corpo padrão de integração ausente (0087) — ver routes/fiscalApuracao.ts.
      const missing = err.code === 'openfinance_disabled'
        ? { reason: 'missing_credentials', provider: 'pluggy' } : {};
      return reply.code(status).send({ error: err.code, ...missing, ...err.payload });
    }
    // Serviço desligado pelo tenant (0088) — 422: não falta credencial, falta
    // autorização de uso. Ver o mesmo tratamento em routes/fiscalApuracao.ts.
    if (err instanceof IntegrationServiceDisabledError) {
      return reply.code(422).send({
        error: err.code, provider: err.providerKey, service: err.serviceKey,
        message: 'Esta operação está desativada nas configurações de integração.',
      });
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

  // Tesouraria (0082): saldo consolidado + realizado 30d + a receber/a pagar
  // 30d + projeção. Leitura pura — não exige Pluggy configurada (sem conexão,
  // devolve saldos vazios e o previsto de receivables/payables mesmo assim).
  fastify.get('/fiscal/openfinance/cash-position', guard('fiscal:view'), async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await cashPosition(tenantId) };
  });

  fastify.post('/fiscal/openfinance/connect-token', guard('bank_accounts:manage'), async (request, reply) => {
    const { tenantId } = (request as any).user;
    try {
      return { data: await connectToken(tenantId) };
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
