import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyRequest, FastifyReply } from 'fastify';

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const mockStripeClient = vi.hoisted(() => ({ isStripeEnabled: vi.fn() }));
vi.mock('../lib/stripeClient', () => mockStripeClient);

import { subscriptionGuard } from '../middleware/subscriptionGuard';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(url: string, user?: Record<string, unknown>): FastifyRequest {
  return { url, user } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { _code?: number; _body?: unknown } {
  const reply: any = {};
  reply.code = vi.fn((c: number) => { reply._code = c; return reply; });
  reply.send = vi.fn((b: unknown) => { reply._body = b; return reply; });
  reply.header = vi.fn().mockReturnValue(reply);
  return reply;
}

function tenantRow(overrides: Record<string, unknown>) {
  return { status: 'trial', trial_ends_at: null, ...overrides };
}

describe('subscriptionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when Stripe is disabled', async () => {
    mockStripeClient.isStripeEnabled.mockReturnValue(false);
    const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
    const reply = makeReply();

    await subscriptionGuard(request, reply);

    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalled();
  });

  describe('when Stripe is enabled', () => {
    beforeEach(() => {
      mockStripeClient.isStripeEnabled.mockReturnValue(true);
    });

    it.each(['/health', '/v1/auth/login', '/v1/subscription/checkout-session', '/v1/public/proposals/abc'])(
      'bypasses excluded prefix %s without querying the DB',
      async (url) => {
        const request = makeRequest(url, { tenantId: TENANT_ID });
        const reply = makeReply();

        await subscriptionGuard(request, reply);

        expect(mockDb.execute).not.toHaveBeenCalled();
        expect(reply.code).not.toHaveBeenCalled();
      },
    );

    it('allows unauthenticated requests through (handled elsewhere)', async () => {
      const request = makeRequest('/v1/orders', undefined);
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(mockDb.execute).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('allows through when the tenant row cannot be found', async () => {
      mockDb.execute.mockResolvedValue({ rows: [] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('allows a legacy tenant on trial with no trial_ends_at (existing production tenants)', async () => {
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'trial', trial_ends_at: null })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('allows a trial that has not expired yet', async () => {
      const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'trial', trial_ends_at: future })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('returns 402 TrialExpired when the trial has ended', async () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'trial', trial_ends_at: past })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).toHaveBeenCalledWith(402);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'TrialExpired' }));
    });

    it('allows an active subscription through', async () => {
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'active' })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it('allows past_due through but attaches an X-Subscription-Warning header', async () => {
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'past_due' })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith('X-Subscription-Warning', expect.any(String));
    });

    it('returns 402 SubscriptionCanceled for a canceled tenant', async () => {
      mockDb.execute.mockResolvedValue({ rows: [tenantRow({ status: 'canceled' })] });
      const request = makeRequest('/v1/orders', { tenantId: TENANT_ID });
      const reply = makeReply();

      await subscriptionGuard(request, reply);

      expect(reply.code).toHaveBeenCalledWith(402);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'SubscriptionCanceled' }));
    });
  });
});
