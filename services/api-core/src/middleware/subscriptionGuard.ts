import { FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { isStripeEnabled } from '../lib/stripeClient';

const EXCLUDED_PREFIXES = [
  '/health',
  '/v1/auth/',
  '/v1/subscription/',
  '/v1/public/',
];

export async function subscriptionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Opt-in: guard only active when Stripe is configured
  if (!isStripeEnabled()) return;

  const url = request.url.split('?')[0];
  if (EXCLUDED_PREFIXES.some(p => url === p.replace(/\/$/, '') || url.startsWith(p))) return;

  const user = (request as any).user;
  if (!user?.tenantId) return; // unauthenticated routes handled separately

  const { rows: [tenant] } = await db.execute<any>(sql`
    SELECT status, trial_ends_at FROM tenants WHERE id = ${user.tenantId} LIMIT 1
  `);

  if (!tenant) return;

  const { status, trial_ends_at } = tenant;

  // Existing production tenants: trial_ends_at IS NULL → always allow
  if (status === 'trial' && !trial_ends_at) return;

  if (status === 'trial') {
    const expired = new Date(trial_ends_at) <= new Date();
    if (!expired) return;
    return reply.code(402).send({
      error:   'TrialExpired',
      message: 'Your 14-day trial has ended. Please subscribe to continue.',
    });
  }

  if (status === 'active') return;

  if (status === 'past_due') {
    reply.header('X-Subscription-Warning', 'Payment past due — please update your payment method');
    return;
  }

  if (status === 'canceled') {
    return reply.code(402).send({
      error:   'SubscriptionCanceled',
      message: 'Your subscription has been canceled. Please subscribe to continue.',
    });
  }
}
