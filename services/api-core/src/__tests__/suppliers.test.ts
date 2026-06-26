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
        return { rows: state.rows };
      }),
      select: vi.fn(() => makeSelectChain(state.rows)),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'sup-1' }]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    },
    suppliers: actual.suppliers ?? {},
  };
});

describe('Suppliers routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    state.rows = [];
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.NFE_REQUESTS_QUEUE_URL;
  });

  describe('GET /v1/suppliers', () => {
    it('returns empty array with total=0 when no suppliers exist', async () => {
      state.rows = [];
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/suppliers',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('returns 401/400 without Bearer token', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/suppliers' });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /v1/suppliers', () => {
    it('returns 400 when company_name is missing for PJ', async () => {
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/suppliers',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ person_type: 'PJ', category: 'services' }),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/suppliers/:id', () => {
    it('returns 404 for unknown supplier id', async () => {
      state.rows = []; // select returns empty → supplier not found
      const token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/suppliers/non-existent-id',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
