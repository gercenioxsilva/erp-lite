import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// ── Regression coverage for the tenants.status/tenants.plan CHECK-constraint
// drift bug: the Stripe webhook wrote status 'past_due'/'canceled' and plan
// 'pro', but the original tenants CHECK constraints only allowed
// status IN ('trial','active','suspended','cancelled') and
// plan IN ('starter','professional','enterprise') — every past_due/canceled
// event, and any Profissional-tier event, failed with Postgres 23514 and was
// silently dropped. Migration 0049 aligns the constraints to the Stripe-code
// vocabulary ('canceled' single-L, 'pro'). This file asserts the route/handler
// logic writes exactly that vocabulary; the real constraint-violation proof is
// in __tests__/integration/subscriptionStatus.integration.test.ts (real DB).

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const mockStripeClient = vi.hoisted(() => ({
  getStripe:      vi.fn(),
  isStripeEnabled: vi.fn(),
}));

vi.mock('../lib/stripeClient', () => mockStripeClient);

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID = 'cus_test123';

function token(app: FastifyInstance, overrides: Record<string, unknown> = {}) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin', ...overrides });
}

// ── db.execute query-content matching helpers ─────────────────────────────
// drizzle's sql`` tag produces `queryChunks`: fixed SQL-text segments as
// `{ value: [str] }` objects interleaved with bound-parameter values as plain
// JS values. We match WHICH statement this is via the fixed text, and pull
// bound-parameter values out by locating the text chunk that names the column
// and reading the very next chunk.
function queryText(query: any): string {
  return JSON.stringify(query?.queryChunks ?? query ?? '');
}

function paramAfterLabel(query: any, label: string): unknown {
  const chunks = query?.queryChunks ?? [];
  const idx = chunks.findIndex(
    (c: any) => c && typeof c === 'object' && Array.isArray(c.value) &&
      typeof c.value[0] === 'string' && c.value[0].includes(label),
  );
  if (idx === -1) return undefined;
  return chunks[idx + 1];
}

function makeExecute(handlers: Array<{ match: RegExp; rows?: unknown[] }>) {
  const calls: any[] = [];
  const fn = vi.fn(async (query: any) => {
    calls.push(query);
    const text = queryText(query);
    for (const h of handlers) {
      if (h.match.test(text)) return { rows: h.rows ?? [] };
    }
    return { rows: [] }; // background workers etc. — harmless default
  });
  return { fn, calls };
}

function stripeMock(overrides: Record<string, any> = {}) {
  return {
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    ...overrides,
  };
}

describe('subscription routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStripeClient.isStripeEnabled.mockReturnValue(false);
    mockStripeClient.getStripe.mockReturnValue(null);
    mockDb.execute.mockResolvedValue({ rows: [] });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  // ── GET /v1/subscription ─────────────────────────────────────────────────
  describe('GET /v1/subscription', () => {
    it('maps tenant + plans rows into the response shape', async () => {
      const trialEndsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
      const { fn } = makeExecute([
        { match: /FROM tenants WHERE id/, rows: [{
          status: 'past_due', plan: 'pro', trial_ends_at: trialEndsAt,
          subscription_period_end: '2026-08-01T00:00:00.000Z', cancel_at_period_end: true,
        }] },
        { match: /FROM plans WHERE is_active/, rows: [
          { id: 'starter', name: 'Starter', price_monthly: '97.00', max_users: 3, max_nfe_per_month: 100, max_clients: 200, features: {} },
          { id: 'pro',     name: 'Profissional', price_monthly: '197.00', max_users: 10, max_nfe_per_month: 500, max_clients: null, features: {} },
        ] },
      ]);
      mockDb.execute.mockImplementation(fn);
      mockStripeClient.isStripeEnabled.mockReturnValue(true);

      const res = await app.inject({
        method: 'GET', url: '/v1/subscription',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('past_due');
      expect(body.plan).toBe('pro');
      expect(body.days_left).toBe(5);
      expect(body.cancel_at_period_end).toBe(true);
      expect(body.stripe_enabled).toBe(true);
      expect(body.plans).toHaveLength(2);
      expect(body.plans[1]).toMatchObject({ id: 'pro', name: 'Profissional', price_monthly: 197 });
    });

    it('defaults to trial/starter when the tenant row is missing', async () => {
      const { fn } = makeExecute([
        { match: /FROM tenants WHERE id/, rows: [] },
        { match: /FROM plans WHERE is_active/, rows: [] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'GET', url: '/v1/subscription',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('trial');
      expect(body.plan).toBe('starter');
      expect(body.days_left).toBeNull();
      expect(body.cancel_at_period_end).toBe(false);
    });
  });

  // ── POST /v1/subscription/checkout-session ──────────────────────────────
  describe('POST /v1/subscription/checkout-session', () => {
    it('returns 503 when Stripe is disabled', async () => {
      mockStripeClient.getStripe.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/checkout-session',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { plan_id: 'pro' },
      });

      expect(res.statusCode).toBe(503);
    });

    it('returns 404 for an unknown plan', async () => {
      mockStripeClient.getStripe.mockReturnValue(stripeMock());
      const { fn } = makeExecute([{ match: /FROM plans WHERE id/, rows: [] }]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/checkout-session',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { plan_id: 'not-a-plan' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when the plan price is still a placeholder', async () => {
      mockStripeClient.getStripe.mockReturnValue(stripeMock());
      const { fn } = makeExecute([
        { match: /FROM plans WHERE id/, rows: [{ stripe_price_id: 'price_placeholder_pro' }] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/checkout-session',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { plan_id: 'pro' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('creates a Checkout session and returns its url on success', async () => {
      const stripe = stripeMock();
      stripe.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/session_abc' });
      mockStripeClient.getStripe.mockReturnValue(stripe);
      const { fn } = makeExecute([
        { match: /FROM plans WHERE id/, rows: [{ stripe_price_id: 'price_real_pro' }] },
        { match: /SELECT stripe_customer_id, company_name FROM tenants/, rows: [{ stripe_customer_id: null, company_name: 'Acme' }] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/checkout-session',
        headers: { authorization: `Bearer ${token(app)}` },
        payload: { plan_id: 'pro' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().url).toBe('https://checkout.stripe.com/session_abc');
      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [{ price: 'price_real_pro', quantity: 1 }] }),
      );
    });
  });

  // ── POST /v1/subscription/portal-session ────────────────────────────────
  describe('POST /v1/subscription/portal-session', () => {
    it('returns 503 when Stripe is disabled', async () => {
      mockStripeClient.getStripe.mockReturnValue(null);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/portal-session',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(503);
    });

    it('returns 400 (not a thrown 500) when the tenant has no stripe_customer_id', async () => {
      mockStripeClient.getStripe.mockReturnValue(stripeMock());
      const { fn } = makeExecute([
        { match: /SELECT stripe_customer_id FROM tenants/, rows: [{ stripe_customer_id: null }] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/portal-session',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message ?? res.json().error).toBeTruthy();
    });

    it('creates a Customer Portal session and returns its url on success', async () => {
      const stripe = stripeMock();
      stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/portal_abc' });
      mockStripeClient.getStripe.mockReturnValue(stripe);
      const { fn } = makeExecute([
        { match: /SELECT stripe_customer_id FROM tenants/, rows: [{ stripe_customer_id: CUSTOMER_ID }] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await app.inject({
        method: 'POST', url: '/v1/subscription/portal-session',
        headers: { authorization: `Bearer ${token(app)}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().url).toBe('https://billing.stripe.com/portal_abc');
      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: CUSTOMER_ID }),
      );
    });
  });

  // ── POST /v1/subscription/webhook ───────────────────────────────────────
  describe('POST /v1/subscription/webhook', () => {
    function inject(app: FastifyInstance, event: unknown) {
      return app.inject({
        method: 'POST', url: '/v1/subscription/webhook',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_test' },
        payload: JSON.stringify(event),
      });
    }

    it('returns 200 no-op when Stripe is fully disabled (no secret at all)', async () => {
      mockStripeClient.getStripe.mockReturnValue(null);
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const res = await inject(app, { id: 'evt_x', type: 'noop' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    });

    it('returns 503 when Stripe is enabled but STRIPE_WEBHOOK_SECRET is missing (misconfiguration)', async () => {
      mockStripeClient.getStripe.mockReturnValue(stripeMock());
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const res = await inject(app, { id: 'evt_x', type: 'noop' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'Webhook not configured' });
    });

    it('returns 400 when the signature is invalid', async () => {
      const stripe = stripeMock();
      stripe.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
      mockStripeClient.getStripe.mockReturnValue(stripe);
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

      const res = await inject(app, { id: 'evt_x', type: 'noop' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Invalid signature' });
    });

    it('accepts a validly-signed event', async () => {
      const event = { id: 'evt_ok', type: 'noop', data: { object: {} } };
      const stripe = stripeMock();
      stripe.webhooks.constructEvent.mockReturnValue(event);
      mockStripeClient.getStripe.mockReturnValue(stripe);
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const { fn } = makeExecute([{ match: /FROM billing_events WHERE stripe_event_id/, rows: [] }]);
      mockDb.execute.mockImplementation(fn);

      const res = await inject(app, event);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    });

    it('skips already-processed events idempotently (no tenant UPDATE re-run)', async () => {
      const event = { id: 'evt_dup', type: 'invoice.payment_failed', data: { object: { customer: CUSTOMER_ID, subscription: 'sub_1' } } };
      const stripe = stripeMock();
      stripe.webhooks.constructEvent.mockReturnValue(event);
      mockStripeClient.getStripe.mockReturnValue(stripe);
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
      const { fn, calls } = makeExecute([
        { match: /FROM billing_events WHERE stripe_event_id/, rows: [{ id: 'existing-row' }] },
      ]);
      mockDb.execute.mockImplementation(fn);

      const res = await inject(app, event);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
      expect(calls.some(c => /UPDATE tenants/.test(queryText(c)))).toBe(false);
    });

    describe('handleStripeEvent — per event type', () => {
      function setupWebhook(event: any, handlers: Array<{ match: RegExp; rows?: unknown[] }>) {
        const stripe = stripeMock();
        stripe.webhooks.constructEvent.mockReturnValue(event);
        mockStripeClient.getStripe.mockReturnValue(stripe);
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        const { fn, calls } = makeExecute([
          { match: /FROM billing_events WHERE stripe_event_id/, rows: [] }, // fresh event
          { match: /SELECT id FROM tenants WHERE stripe_customer_id/, rows: [{ id: TENANT_ID }] },
          ...handlers,
        ]);
        mockDb.execute.mockImplementation(fn);
        return { calls };
      }

      it('checkout.session.completed links stripe_customer_id to the tenant', async () => {
        const event = { id: 'evt_cs', type: 'checkout.session.completed', data: { object: { customer: CUSTOMER_ID, metadata: { tenant_id: TENANT_ID } } } };
        const { calls } = setupWebhook(event, []);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /UPDATE tenants SET stripe_customer_id/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'stripe_customer_id')).toBe(CUSTOMER_ID);

        const insertCall = calls.find(c => /INSERT INTO billing_events/.test(queryText(c)));
        expect(insertCall).toBeTruthy();
      });

      it('customer.subscription.created — starter tier + active status', async () => {
        const event = {
          id: 'evt_starter', type: 'customer.subscription.created',
          data: { object: { customer: CUSTOMER_ID, id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_starter' } }] } } },
        };
        const { calls } = setupWebhook(event, [
          { match: /SELECT id FROM plans WHERE stripe_price_id/, rows: [{ id: 'starter' }] },
        ]);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /cancel_at_period_end/.test(queryText(c)) && /UPDATE tenants/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'status')).toBe('active');
        expect(paramAfterLabel(updateCall, 'plan')).toBe('starter');
        expect(paramAfterLabel(updateCall, 'subscription_period_end')).toBe(new Date(1_800_000_000 * 1000).toISOString());
      });

      // Regression coverage for the webhook endpoint being pinned to a
      // post-Basil Stripe API version (2025-03-31+), which no longer sends
      // current_period_end on the Subscription object itself — only on each
      // subscription item. Without the items[0] fallback in subscription.ts,
      // subscription_period_end silently goes back to NULL for every tenant.
      it('customer.subscription.updated — reads current_period_end from items[0] when absent on the subscription object (Basil+ API shape)', async () => {
        const event = {
          id: 'evt_basil_shape', type: 'customer.subscription.updated',
          data: { object: {
            customer: CUSTOMER_ID, id: 'sub_4', status: 'active', cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_800_000_000 }] },
          } },
        };
        const { calls } = setupWebhook(event, [
          { match: /SELECT id FROM plans WHERE stripe_price_id/, rows: [{ id: 'pro' }] },
        ]);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /cancel_at_period_end/.test(queryText(c)) && /UPDATE tenants/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'subscription_period_end')).toBe(new Date(1_800_000_000 * 1000).toISOString());
      });

      it('customer.subscription.updated — resolves subscription_period_end to null (not a throw) when current_period_end is absent everywhere', async () => {
        const event = {
          id: 'evt_no_period', type: 'customer.subscription.updated',
          data: { object: {
            customer: CUSTOMER_ID, id: 'sub_5', status: 'active', cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro' } }] },
          } },
        };
        const { calls } = setupWebhook(event, [
          { match: /SELECT id FROM plans WHERE stripe_price_id/, rows: [{ id: 'pro' }] },
        ]);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /cancel_at_period_end/.test(queryText(c)) && /UPDATE tenants/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'subscription_period_end')).toBeNull();
      });

      it('customer.subscription.updated — pro tier + past_due status (the exact scenario that used to violate the CHECK constraint)', async () => {
        const event = {
          id: 'evt_pro_pastdue', type: 'customer.subscription.updated',
          data: { object: { customer: CUSTOMER_ID, id: 'sub_2', status: 'past_due', cancel_at_period_end: false, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_pro' } }] } } },
        };
        const { calls } = setupWebhook(event, [
          { match: /SELECT id FROM plans WHERE stripe_price_id/, rows: [{ id: 'pro' }] },
        ]);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /cancel_at_period_end/.test(queryText(c)) && /UPDATE tenants/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'status')).toBe('past_due');
        expect(paramAfterLabel(updateCall, 'plan')).toBe('pro');
      });

      it('customer.subscription.updated — enterprise tier + canceled status', async () => {
        const event = {
          id: 'evt_ent_canceled', type: 'customer.subscription.updated',
          data: { object: { customer: CUSTOMER_ID, id: 'sub_3', status: 'canceled', cancel_at_period_end: true, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_enterprise' } }] } } },
        };
        const { calls } = setupWebhook(event, [
          { match: /SELECT id FROM plans WHERE stripe_price_id/, rows: [{ id: 'enterprise' }] },
        ]);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /cancel_at_period_end/.test(queryText(c)) && /UPDATE tenants/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(paramAfterLabel(updateCall, 'status')).toBe('canceled');
        expect(paramAfterLabel(updateCall, 'plan')).toBe('enterprise');
      });

      it('customer.subscription.deleted sets status = canceled and clears subscription fields', async () => {
        const event = { id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { customer: CUSTOMER_ID } } };
        const { calls } = setupWebhook(event, []);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /stripe_subscription_id = NULL/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
        expect(queryText(updateCall)).toMatch(/status\s+=\s+'canceled'/);
      });

      it('invoice.payment_succeeded sets status = active', async () => {
        const event = { id: 'evt_paid', type: 'invoice.payment_succeeded', data: { object: { customer: CUSTOMER_ID, subscription: 'sub_1' } } };
        const { calls } = setupWebhook(event, []);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /UPDATE tenants SET status = 'active'/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
      });

      it('invoice.payment_failed sets status = past_due', async () => {
        const event = { id: 'evt_failed', type: 'invoice.payment_failed', data: { object: { customer: CUSTOMER_ID, subscription: 'sub_1' } } };
        const { calls } = setupWebhook(event, []);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);

        const updateCall = calls.find(c => /UPDATE tenants SET status = 'past_due'/.test(queryText(c)));
        expect(updateCall).toBeTruthy();
      });

      it('is a no-op (no UPDATE/INSERT) when no tenant can be resolved for the event', async () => {
        const event = { id: 'evt_orphan', type: 'invoice.payment_failed', data: { object: { customer: 'cus_unknown', subscription: 'sub_1' } } };
        const stripe = stripeMock();
        stripe.webhooks.constructEvent.mockReturnValue(event);
        mockStripeClient.getStripe.mockReturnValue(stripe);
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        const { fn, calls } = makeExecute([
          { match: /FROM billing_events WHERE stripe_event_id/, rows: [] },
          { match: /SELECT id FROM tenants WHERE stripe_customer_id/, rows: [] }, // no match, no metadata.tenant_id either
        ]);
        mockDb.execute.mockImplementation(fn);

        const res = await inject(app, event);
        expect(res.statusCode).toBe(200);
        expect(calls.some(c => /UPDATE tenants/.test(queryText(c)))).toBe(false);
        expect(calls.some(c => /INSERT INTO billing_events/.test(queryText(c)))).toBe(false);
      });
    });
  });
});
