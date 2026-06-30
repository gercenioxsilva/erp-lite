import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

const state: { rows: any[] } = { rows: [] };

function makeSelectChain(rows: any[]) {
  const chain: any = {
    from:    () => chain,
    where:   () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
  };
  return chain;
}

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async (query: any) => {
        const text = JSON.stringify(query?.queryChunks ?? query ?? '');
        if (/COUNT/i.test(text)) return { rows: [{ count: String(state.rows.length) }] };
        if (/total_accrued/i.test(text)) return { rows: [{ total_accrued: '0', total_cancelled: '0' }] };
        return { rows: state.rows };
      }),
      select: vi.fn(() => makeSelectChain(state.rows)),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'seller-1' }]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve({ rowCount: 1 }) }) })),
    },
    sellers: actual.sellers ?? {},
  };
});

describe('Sellers routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.rows = [];
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/sellers', () => {
    it('returns empty array with total=0 when no sellers exist', async () => {
      state.rows = [];
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sellers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns 401/400 without Bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/sellers' });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /v1/sellers', () => {
    it('returns 400 when name is missing', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sellers',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'vendedor@example.com' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when default_commission_pct is out of range', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sellers',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'João Vendedor', default_commission_pct: 150 }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when commission_base is invalid', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sellers',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'João Vendedor', commission_base: 'invalid' }),
      });
      expect(res.statusCode).toBe(400);
    });

    it('creates a seller with valid payload', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sellers',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ name: 'João Vendedor', default_commission_pct: 5 }),
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('GET /v1/sellers/:id', () => {
    it('returns 404 for unknown seller id', async () => {
      state.rows = []; // select returns empty → seller not found
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sellers/non-existent-id',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /v1/sellers/:id/commissions', () => {
    it('returns 404 when seller does not exist', async () => {
      state.rows = [];
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sellers/non-existent-id/commissions',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns extrato with summary totals when seller exists', async () => {
      state.rows = [{ id: 'seller-1' }];
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sellers/seller-1/commissions',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary).toEqual({ total_accrued: 0, total_cancelled: 0 });
    });
  });
});
