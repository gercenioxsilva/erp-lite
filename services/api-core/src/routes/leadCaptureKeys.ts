// Gestão de chaves de Captação de Leads — rotas INTERNAS (JWT +
// lead_capture:manage, owner/admin — mesma trava de bank_accounts:manage/
// engine:manage: chave de API é credencial de longa duração). O segredo
// aparece só na resposta do POST; GET nunca o devolve.
//
// Toda chave criada aqui nasce 'publishable' (pk_live_...) com escopo ÚNICO
// e fixo 'leads:create' — é a chave pensada pra ficar embutida em JS
// client-side de landing page (padrão Stripe): no pior caso de vazamento,
// só permite criar lead (mitigável por rate limit), nunca ler/listar nada.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  createKey, listKeys, revokeKey, usageSummary, EngineKeyError,
} from '../services/engineKeyService';

const LEAD_KEY_SCOPE = 'leads:create';
// Bem mais baixo que o default do Engine (60) — chave pensada pra tráfego de
// formulário humano, não integração servidor-a-servidor.
const LEAD_KEY_RATE_LIMIT_PER_MIN = 10;

export const leadCaptureKeysRoutes: FastifyPluginAsync = async (fastify) => {
  const guard = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('lead_capture'), requirePermission('lead_capture:manage')],
  };

  fastify.post('/lead-capture-keys', guard, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { name, allowed_origins } = (request.body ?? {}) as { name?: string; allowed_origins?: string[] };
    try {
      const key = await createKey(tenantId, name ?? '', userId ?? null, undefined, {
        scopes: [LEAD_KEY_SCOPE],
        keyType: 'publishable',
        rateLimitPerMin: LEAD_KEY_RATE_LIMIT_PER_MIN,
        allowedOrigins: Array.isArray(allowed_origins) && allowed_origins.length ? allowed_origins : null,
      });
      // ATENÇÃO: `secret` só existe nesta resposta — a UI avisa o usuário.
      return reply.code(201).send({ success: true, data: key });
    } catch (err) {
      if (err instanceof EngineKeyError) return reply.code(422).send({ success: false, error: err.code });
      throw err;
    }
  });

  fastify.get('/lead-capture-keys', guard, async (request) => {
    const { tenantId } = (request as any).user;
    return { success: true, data: await listKeys(tenantId, undefined, LEAD_KEY_SCOPE) };
  });

  fastify.delete('/lead-capture-keys/:id', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return { success: true, data: await revokeKey(tenantId, id, undefined, LEAD_KEY_SCOPE) };
    } catch (err) {
      if (err instanceof EngineKeyError) return reply.code(404).send({ success: false, error: err.code });
      throw err;
    }
  });

  fastify.get('/lead-capture-keys/usage', guard, async (request) => {
    const { tenantId } = (request as any).user;
    const { days } = request.query as { days?: string };
    const n = Math.min(Math.max(Number(days) || 30, 1), 90);
    return { success: true, data: await usageSummary(tenantId, n) };
  });
};
