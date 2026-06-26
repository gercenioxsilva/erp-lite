import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({
    send: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      execute: vi.fn(async () => ({ rows: [] })),
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve([]) }),
      })),
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
      transaction: vi.fn(),
    },
  };
});

describe('Proposals routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    token = app.jwt.sign({ tenantId: 'tenant-1', userId: 'user-1', email: 'admin@test.com', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/proposals without auth returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/proposals',
      payload: { title: 'Test', items: [{ name: 'Item', quantity: 1, unit_price: 100 }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('GET /v1/proposals returns pagination shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/proposals',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('page');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/public/proposals/abc returns 404 for short token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/proposals/abc',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /v1/public/proposals/[64 hex] returns 404 when not found', async () => {
    const validToken = 'a'.repeat(64);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/proposals/${validToken}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/public/proposals/[token]/accept without name returns 400', async () => {
    const validToken = 'b'.repeat(64);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/public/proposals/${validToken}/accept`,
      payload: { email: 'test@test.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/public/proposals/abc/reject with invalid token returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/public/proposals/abc/reject',
      payload: { reason: 'Too expensive' },
    });
    expect(res.statusCode).toBe(404);
  });
});
