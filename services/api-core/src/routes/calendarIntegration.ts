// Rotas da Integração Google Calendar — connect/status/disconnect (por
// profissional) + callback público do OAuth. Espelho de marketplaceIntegration,
// mas gated pelo módulo 'scheduling' e chaveado por professional_id.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  getAuthorizationUrl, handleOAuthCallback, getConnectionStatus, disconnectConnection,
  GoogleCalendarDomainError,
} from '../services/googleCalendarService';

export const calendarIntegrationRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate], preHandler: [requireModule('scheduling')] };

  const mask = (t: string | null | undefined) => (t ? '****' + t.slice(-4) : null);

  /* ── GET /v1/integrations/google/connect ────────────────────────────── */
  fastify.get('/integrations/google/connect', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('scheduling:manage') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { professional_id } = request.query as { professional_id?: string };
    if (!professional_id) return reply.badRequest('professional_id é obrigatório');

    try {
      const authorization_url = await getAuthorizationUrl(tenantId, professional_id);
      return { authorization_url };
    } catch (err) {
      if (err instanceof GoogleCalendarDomainError) {
        if (err.code === 'professional_not_found') return reply.notFound('Profissional não encontrado');
        if (err.code === 'google_not_configured')  return reply.code(422).send({ error: err.code, message: 'Integração com o Google Calendar não está configurada neste ambiente.' });
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── GET /v1/integrations/google/status ─────────────────────────────── */
  fastify.get('/integrations/google/status', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('scheduling:view') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { professional_id } = request.query as { professional_id?: string };
    if (!professional_id) return reply.badRequest('professional_id é obrigatório');

    try {
      const connection = await getConnectionStatus(tenantId, professional_id);
      if (!connection) return { connected: false };
      return {
        connected: connection.status === 'connected',
        status: connection.status,
        google_account_email: connection.google_account_email,
        connected_at: connection.connected_at,
        access_token: mask(connection.access_token),
      };
    } catch (err) {
      if (err instanceof GoogleCalendarDomainError && err.code === 'professional_not_found') return reply.notFound('Profissional não encontrado');
      throw err;
    }
  });

  /* ── DELETE /v1/integrations/google ─────────────────────────────────── */
  fastify.delete('/integrations/google', { ...auth, preHandler: [ ...(auth.preHandler ?? []), requirePermission('scheduling:manage') ] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { professional_id } = request.query as { professional_id?: string };
    if (!professional_id) return reply.badRequest('professional_id é obrigatório');

    try {
      await disconnectConnection(tenantId, professional_id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof GoogleCalendarDomainError) {
        if (err.code === 'professional_not_found' || err.code === 'connection_not_found') return reply.notFound('Conexão não encontrada');
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      throw err;
    }
  });

  /* ── GET /v1/public/integrations/google/callback ────────────────────── */
  // Público — o Google redireciona o navegador do usuário para cá após a
  // autorização. O state (HMAC) é a única fonte do profissional, nunca um JWT.
  // Sempre termina em redirect de volta para o app (nunca JSON).
  fastify.get('/public/integrations/google/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    const appUrl = process.env.APP_URL || 'https://orquestraerp.com.br';
    // Erro: não temos o professional_id de forma confiável → volta para a lista.
    const listBack = (q: string) => `${appUrl}/scheduling/professionals?gcal_status=${q}`;

    if (!code || !state) return reply.redirect(listBack('error&reason=missing_params'));

    try {
      const conn = await handleOAuthCallback(code, state);
      // Sucesso: volta direto à tela do profissional que iniciou a conexão.
      return reply.redirect(`${appUrl}/scheduling/professionals/${conn.professional_id}?gcal_status=connected`);
    } catch (err) {
      const reason = err instanceof GoogleCalendarDomainError ? err.code : 'unknown_error';
      return reply.redirect(listBack(`error&reason=${encodeURIComponent(reason)}`));
    }
  });
};
