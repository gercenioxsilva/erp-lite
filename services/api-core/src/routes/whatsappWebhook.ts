import { FastifyPluginAsync } from 'fastify';
import { resolveWebhookAccount, validateSignature, ingestWebhook, type WebhookParams } from '../services/whatsappWebhookService';

export const whatsappWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Twilio manda o webhook como application/x-www-form-urlencoded — parser
  // dedicado, escopado só a este plugin (mesmo padrão de
  // subscriptionWebhookRoute pro raw body do Stripe em routes/subscription.ts).
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = Object.fromEntries(new URLSearchParams(body as string));
      done(null, params);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  /* ── POST /v1/public/whatsapp/webhook ─────────────────────────────────── */
  // Público — o Twilio chama este endpoint (status de entrega + mensagem
  // recebida). O payload nunca é fonte de verdade sobre negócio, só um
  // gatilho (mesmo racional do webhook Mercado Livre, regra 42): sempre
  // responde 200 rápido, mesmo em erro/assinatura inválida — nunca deixar o
  // Twilio nos marcar como endpoint instável.
  fastify.post('/public/whatsapp/webhook', async (request, reply) => {
    try {
      const params = request.body as WebhookParams & Record<string, string>;

      const account = await resolveWebhookAccount(params);
      if (!account?.credentials) {
        fastify.log.warn({ event: 'whatsapp_webhook_unknown_number' });
        return reply.code(200).send({ ok: true });
      }

      const authToken = (account.credentials as Record<string, string>).auth_token;
      const requestUrl = `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/v1/public/whatsapp/webhook`;
      const signatureHeader = request.headers['x-twilio-signature'] as string | undefined;

      if (!validateSignature(requestUrl, params, signatureHeader, authToken)) {
        fastify.log.warn({ event: 'whatsapp_webhook_bad_signature', tenant_id: account.tenant_id });
        return reply.code(200).send({ ok: true });
      }

      await ingestWebhook(account.tenant_id, params);
    } catch (err) {
      fastify.log.error({ event: 'whatsapp_webhook_error', error: String(err) });
    }
    return reply.code(200).send({ ok: true });
  });
};
