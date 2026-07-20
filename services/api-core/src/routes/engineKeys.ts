// Gestão de chaves do Fiscal Engine — rotas INTERNAS (JWT + engine:manage,
// owner/admin). O segredo aparece só na resposta do POST; GET nunca o devolve.

import { FastifyPluginAsync } from 'fastify';
import { requireModule } from '../lib/requireModule';
import { requirePermission } from '../lib/requirePermission';
import {
  createKey, listKeys, revokeKey, usageSummary, EngineKeyError,
} from '../services/engineKeyService';

export const engineKeysRoutes: FastifyPluginAsync = async (fastify) => {
  const guard = {
    onRequest: [(fastify as any).authenticate],
    preHandler: [requireModule('engine'), requirePermission('engine:manage')],
  };

  fastify.post('/engine-keys', guard, async (request, reply) => {
    const { tenantId, userId } = (request as any).user;
    const { name } = (request.body ?? {}) as { name?: string };
    try {
      const key = await createKey(tenantId, name ?? '', userId ?? null);
      // ATENÇÃO: `secret` só existe nesta resposta — a UI avisa o usuário.
      return reply.code(201).send({ success: true, data: key });
    } catch (err) {
      if (err instanceof EngineKeyError) return reply.code(422).send({ success: false, error: err.code });
      throw err;
    }
  });

  fastify.get('/engine-keys', guard, async (request) => {
    const { tenantId } = (request as any).user;
    return { success: true, data: await listKeys(tenantId, undefined, 'engine') };
  });

  fastify.delete('/engine-keys/:id', guard, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    try {
      return { success: true, data: await revokeKey(tenantId, id, undefined, 'engine') };
    } catch (err) {
      if (err instanceof EngineKeyError) return reply.code(404).send({ success: false, error: err.code });
      throw err;
    }
  });

  fastify.get('/engine-keys/usage', guard, async (request) => {
    const { tenantId } = (request as any).user;
    const { days } = request.query as { days?: string };
    const n = Math.min(Math.max(Number(days) || 30, 1), 90);
    return { success: true, data: await usageSummary(tenantId, n) };
  });
};
