import { FastifyPluginAsync } from 'fastify';
import { ingestWebhook } from '../services/marketplaceWebhookService';

export const marketplaceWebhookRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── POST /v1/public/marketplace/mercadolivre/webhook ───────────────── */
  // Público — o Mercado Livre chama este endpoint. O payload nunca é fonte de
  // verdade, só um gatilho (regra 42): sempre responde 200 rápido, mesmo em
  // erro interno, para nunca fazer o ML nos marcar como endpoint instável.
  fastify.post('/public/marketplace/mercadolivre/webhook', async (request, reply) => {
    try {
      await ingestWebhook(request.body as any);
    } catch (err) {
      fastify.log.error({ event: 'marketplace_webhook_error', error: String(err) });
    }
    return reply.code(200).send({ ok: true });
  });
};
