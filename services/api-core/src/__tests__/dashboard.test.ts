import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

// Zero-return mock for all dashboard queries
vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async () => ({
        rows: [
          {
            pending_count: 0, pending_amount: 0, overdue_count: 0, overdue_amount: 0,
            due_week_count: 0, due_week_amount: 0,
            revenue_this_month: 0, revenue_last_month: 0,
            pending_orders: 0,
            month: '2026-01', total: 0,
          },
        ],
      })),
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve([]) }),
      })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      transaction: vi.fn(),
    },
  };
});

describe('Dashboard routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    // Sign a fake JWT so authenticate passes
    token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/dashboard', () => {
    it('returns all expected top-level keys', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('receivables');
      expect(body).toHaveProperty('payables');
      expect(body).toHaveProperty('revenue');
      expect(body).toHaveProperty('orders');
      expect(body).toHaveProperty('revenue_by_month');
    });

    it('receivables block has correct shape', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.receivables.pending_count).toBe('number');
      expect(typeof body.receivables.pending_amount).toBe('number');
      expect(typeof body.receivables.overdue_count).toBe('number');
      expect(typeof body.receivables.overdue_amount).toBe('number');
    });

    it('revenue_by_month is an array', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.revenue_by_month)).toBe(true);
    });

    it('returns 401 without authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard',
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
