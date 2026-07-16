// Assistente Fiscal IA — POST /v1/fiscal/assistant (fiscal:view).
// 503 sem ANTHROPIC_API_KEY; 429 no cap diário por tenant; 502 em falha do
// provider (o status da Anthropic NUNCA é repassado — ver assistantUpstream).

import { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import { CompanyDomainError } from '../services/companyService';
import { AssistantError, runAssistant, AssistantHistoryMessage } from '../services/fiscalAssistantService';

const MAX_MESSAGE_CHARS = 2000;

export const fiscalAssistantRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;
  const guard = {
    onRequest:  [authenticate],
    preHandler: [requireModule('fiscal'), requirePermission('fiscal:view')],
  };

  fastify.post('/fiscal/assistant', guard, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const b = request.body as { message?: string; history?: AssistantHistoryMessage[]; company_id?: string };
    if (!b?.message || typeof b.message !== 'string' || b.message.trim() === '') {
      return reply.badRequest('message é obrigatória');
    }
    if (b.message.length > MAX_MESSAGE_CHARS) {
      return reply.badRequest(`message excede ${MAX_MESSAGE_CHARS} caracteres`);
    }
    try {
      return await runAssistant({
        tenantId, userId,
        companyId: b.company_id ?? null,
        message: b.message.trim(),
        history: Array.isArray(b.history) ? b.history : [],
      });
    } catch (err) {
      if (err instanceof AssistantError) {
        if (err.code === 'assistant_disabled') return reply.code(503).send({ error: err.code });
        return reply.code(429).send({ error: err.code, ...err.payload });
      }
      if (err instanceof CompanyDomainError) {
        return reply.code(422).send({ error: err.code, ...err.payload });
      }
      // Falha do provider: o APIError do SDK carrega o status upstream e o
      // Fastify respeita err.statusCode — repassar seria perigoso e enganoso.
      // Um 401 da Anthropic (key inválida/revogada) dispararia o auto-logout do
      // backoffice (api.ts desloga em qualquer 401 com token), expulsando o
      // usuário do ERP por um erro de configuração do chat; e um 429 upstream
      // se disfarçaria do cap diário do tenant. A mensagem crua também não sobe:
      // vaza detalhe de credencial e request_id da Anthropic pro cliente.
      if (err instanceof Anthropic.APIError) {
        request.log.error({ err, status: err.status }, 'assistant_upstream_error');
        return reply.code(502).send({ error: 'assistant_upstream_error' });
      }
      throw err;
    }
  });
};
