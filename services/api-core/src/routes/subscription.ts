import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { getStripe, isStripeEnabled } from '../lib/stripeClient';

const APP_URL = process.env.APP_URL || 'https://orquestraerp.com.br';

// ── Authenticated subscription routes ─────────────────────────────────────────
export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /v1/subscription — current subscription state + available plans
  fastify.get('/subscription', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const { rows: [tenant] } = await db.execute<any>(sql`
      SELECT status, plan, trial_ends_at, subscription_period_end, cancel_at_period_end
      FROM tenants WHERE id = ${tenantId} LIMIT 1
    `);

    const { rows: plansRows } = await db.execute<any>(sql`
      SELECT id, name, price_monthly, max_users, max_nfe_per_month, max_clients, features, display_order
      FROM plans WHERE is_active = TRUE ORDER BY display_order
    `);

    let days_left: number | null = null;
    if (tenant?.trial_ends_at) {
      const diff = new Date(tenant.trial_ends_at).getTime() - Date.now();
      days_left = Math.max(0, Math.ceil(diff / 86_400_000));
    }

    return {
      status:                tenant?.status ?? 'trial',
      plan:                  tenant?.plan ?? 'starter',
      days_left,
      subscription_period_end: tenant?.subscription_period_end ?? null,
      cancel_at_period_end:    tenant?.cancel_at_period_end ?? false,
      stripe_enabled:          isStripeEnabled(),
      plans: plansRows.map((p: any) => ({
        id:                p.id,
        name:              p.name,
        price_monthly:     Number(p.price_monthly),
        max_users:         p.max_users,
        max_nfe_per_month: p.max_nfe_per_month,
        max_clients:       p.max_clients,
        features:          p.features,
      })),
    };
  });

  // POST /v1/subscription/checkout-session — creates Stripe Checkout session
  fastify.post('/subscription/checkout-session', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { plan_id } = request.body as { plan_id: string };

    const stripe = getStripe();
    if (!stripe) return reply.serviceUnavailable('Stripe not configured');

    const { rows: [plan] } = await db.execute<any>(sql`
      SELECT stripe_price_id FROM plans WHERE id = ${plan_id} AND is_active = TRUE LIMIT 1
    `);
    if (!plan) return reply.notFound('Plan not found');

    if (plan.stripe_price_id === 'price_placeholder' || plan.stripe_price_id.startsWith('price_placeholder')) {
      return reply.badRequest('Plan price not configured in Stripe yet');
    }

    const { rows: [tenant] } = await db.execute<any>(sql`
      SELECT stripe_customer_id, company_name FROM tenants WHERE id = ${tenantId} LIMIT 1
    `);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: tenant?.stripe_customer_id || undefined,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      subscription_data: { trial_period_days: undefined },
      metadata: { tenant_id: tenantId, plan_id },
      success_url: `${APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/billing`,
    });

    return { url: session.url };
  });

  // POST /v1/subscription/portal-session — creates Stripe Customer Portal session
  fastify.post('/subscription/portal-session', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;

    const stripe = getStripe();
    if (!stripe) return reply.serviceUnavailable('Stripe not configured');

    const { rows: [tenant] } = await db.execute<any>(sql`
      SELECT stripe_customer_id FROM tenants WHERE id = ${tenantId} LIMIT 1
    `);
    if (!tenant?.stripe_customer_id) {
      return reply.badRequest('No Stripe customer found for this tenant');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   tenant.stripe_customer_id,
      return_url: `${APP_URL}/billing`,
    });

    return { url: session.url };
  });
};

// ── Webhook route (separate plugin — needs raw string body for sig verification) ─
export const subscriptionWebhookRoute: FastifyPluginAsync = async (fastify) => {
  // Override content-type parser scoped to this plugin only
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  fastify.post('/subscription/webhook', async (request, reply) => {
    const stripe = getStripe();
    if (!stripe) return reply.send({ received: true });

    const sig     = request.headers['stripe-signature'] as string;
    const secret  = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = request.body as string;

    if (!secret) {
      fastify.log.error('STRIPE_WEBHOOK_SECRET not set while Stripe is enabled — rejecting webhook');
      return reply.code(503).send({ error: 'Webhook not configured' });
    }

    let event: any;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, 'Stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // Idempotency: skip already-processed events
    const { rows: existing } = await db.execute<any>(sql`
      SELECT id FROM billing_events WHERE stripe_event_id = ${event.id} LIMIT 1
    `);
    if (existing.length > 0) return reply.send({ received: true });

    await handleStripeEvent(event, fastify);
    return reply.send({ received: true });
  });
};

async function handleStripeEvent(event: any, fastify: any) {
  const data = event.data?.object ?? {};

  // Resolve tenant_id from stripe_customer_id
  let tenantId: string | null = null;
  if (data.customer) {
    const { rows: [t] } = await db.execute<any>(sql`
      SELECT id FROM tenants WHERE stripe_customer_id = ${data.customer} LIMIT 1
    `);
    tenantId = t?.id ?? null;
  }
  // Fallback: metadata on checkout session
  if (!tenantId && data.metadata?.tenant_id) {
    tenantId = data.metadata.tenant_id;
  }

  if (!tenantId) {
    fastify.log.warn({ event_type: event.type, event_id: event.id }, 'No tenant found for Stripe event');
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Link stripe_customer_id to tenant on first checkout
        if (data.customer) {
          await db.execute(sql`
            UPDATE tenants SET stripe_customer_id = ${data.customer} WHERE id = ${tenantId}
          `);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub       = data;
        const priceId   = sub.items?.data?.[0]?.price?.id ?? null;
        const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
        const status    = mapStripeStatus(sub.status);
        const planId    = await resolvePlanIdFromPrice(priceId);

        await db.execute(sql`
          UPDATE tenants SET
            stripe_subscription_id  = ${sub.id},
            stripe_price_id         = ${priceId},
            subscription_period_end = ${periodEnd},
            cancel_at_period_end    = ${sub.cancel_at_period_end ?? false},
            status                  = ${status},
            plan                    = ${planId ?? sql`plan`}
          WHERE id = ${tenantId}
        `);
        break;
      }

      case 'customer.subscription.deleted': {
        await db.execute(sql`
          UPDATE tenants SET
            status                 = 'canceled',
            stripe_subscription_id = NULL,
            subscription_period_end = NULL
          WHERE id = ${tenantId}
        `);
        break;
      }

      case 'invoice.payment_succeeded': {
        if (data.subscription) {
          await db.execute(sql`
            UPDATE tenants SET status = 'active' WHERE id = ${tenantId}
          `);
        }
        break;
      }

      case 'invoice.payment_failed': {
        if (data.subscription) {
          await db.execute(sql`
            UPDATE tenants SET status = 'past_due' WHERE id = ${tenantId}
          `);
        }
        break;
      }
    }

    await db.execute(sql`
      INSERT INTO billing_events (tenant_id, stripe_event_id, event_type, payload)
      VALUES (${tenantId}, ${event.id}, ${event.type}, ${JSON.stringify(event)})
    `);
  } catch (err) {
    fastify.log.error({ err, event_id: event.id }, 'Error processing Stripe event');
    throw err;
  }
}

// Nunca mascarar um status desconhecido/de problema como 'trial' — isso
// escondia assinaturas com pagamento pendente/travado atrás de um rótulo
// errado (causa raiz de "todos os produtos voltando trial"). 'incomplete'/
// 'paused' viram 'past_due' (precisam de atenção, mas não são trial nem
// canceladas); 'incomplete_expired' vira 'canceled' (nunca chegou a ativar
// e expirou). Qualquer status realmente inesperado no futuro também cai em
// 'past_due' — nunca em 'trial' — e loga um aviso para investigação.
export function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active':             return 'active';
    case 'trialing':           return 'trial';
    case 'past_due':           return 'past_due';
    case 'unpaid':             return 'past_due';
    case 'incomplete':         return 'past_due';
    case 'paused':             return 'past_due';
    case 'canceled':           return 'canceled';
    case 'incomplete_expired': return 'canceled';
    default:
      console.warn(`[Stripe] status de assinatura desconhecido recebido do webhook: "${stripeStatus}" — mantendo como past_due`);
      return 'past_due';
  }
}

async function resolvePlanIdFromPrice(priceId: string | null): Promise<string | null> {
  if (!priceId) return null;
  const { rows: [plan] } = await db.execute<any>(sql`
    SELECT id FROM plans WHERE stripe_price_id = ${priceId} LIMIT 1
  `);
  return plan?.id ?? null;
}
