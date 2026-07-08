import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  getAuthorizationUrl, handleOAuthCallback, getConnectionStatus, disconnectConnection, listConnections,
  MarketplaceDomainError,
} from '../services/marketplaceConnectionService';

export const marketplaceIntegrationRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('mercadolivre')] };

  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);

  /* ── GET /v1/integrations/mercadolivre/connections ──────────────────── */
  // Sem gate de módulo — listar conexões já existentes é leitura inofensiva,
  // usada por outras telas (ex.: vincular material) para montar o seletor de
  // "qual loja ML" sem precisar de N chamadas por empresa.
  fastify.get('/integrations/mercadolivre/connections', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('marketplace:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const rows = await listConnections(tenantId);
    return { data: rows.map(r => ({ ...r, access_token: mask(r.access_token), refresh_token: mask(r.refresh_token) })) };
  });

  /* ── GET /v1/integrations/mercadolivre/connect ──────────────────────── */
  fastify.get('/integrations/mercadolivre/connect', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('marketplace:manage') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { company_id } = request.query as { company_id?: string };
    if (!company_id) return reply.badRequest('company_id é obrigatório');

    try {
      const authorization_url = await getAuthorizationUrl(tenantId, company_id);
      return { authorization_url };
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── GET /v1/integrations/mercadolivre/status ───────────────────────── */
  fastify.get('/integrations/mercadolivre/status', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('marketplace:view') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { company_id } = request.query as { company_id?: string };
    if (!company_id) return reply.badRequest('company_id é obrigatório');

    try {
      const connection = await getConnectionStatus(tenantId, company_id);
      if (!connection) return { connected: false };
      return {
        connected: connection.status === 'connected',
        status: connection.status,
        nickname: connection.nickname,
        ml_user_id: connection.ml_user_id,
        connected_at: connection.connected_at,
        access_token: mask(connection.access_token),
      };
    } catch (err) {
      if (err instanceof MarketplaceDomainError && err.code === 'company_not_found') return reply.notFound('Empresa não encontrada');
      throw err;
    }
  });

  /* ── DELETE /v1/integrations/mercadolivre ───────────────────────────── */
  fastify.delete('/integrations/mercadolivre', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('marketplace:manage') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { company_id } = request.query as { company_id?: string };
    if (!company_id) return reply.badRequest('company_id é obrigatório');

    try {
      await disconnectConnection(tenantId, company_id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MarketplaceDomainError) {
        if (err.code === 'company_not_found' || err.code === 'connection_not_found') return reply.notFound('Conexão não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── GET /v1/public/integrations/mercadolivre/callback ──────────────── */
  // Público — o Mercado Livre redireciona o navegador do usuário para cá após
  // a autorização. O state (assinado por HMAC) é a única fonte da empresa,
  // nunca um JWT. Sempre termina em redirect de volta para o app (nunca JSON),
  // já que quem chega aqui é o navegador do usuário, não uma chamada de API.
  fastify.get('/public/integrations/mercadolivre/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';

    if (!code || !state) {
      return reply.redirect(`${appUrl}/company?ml_status=error&reason=missing_params`);
    }

    try {
      await handleOAuthCallback(code, state);
      return reply.redirect(`${appUrl}/company?ml_status=connected`);
    } catch (err) {
      const reason = err instanceof MarketplaceDomainError ? err.code : 'unknown_error';
      return reply.redirect(`${appUrl}/company?ml_status=error&reason=${encodeURIComponent(reason)}`);
    }
  });
};
