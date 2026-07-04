import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

describe('POST /v1/public/marketplace/mercadolivre/webhook', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('always responds 200, even for a malformed payload (nunca derruba o webhook)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/public/marketplace/mercadolivre/webhook',
      payload: { foo: 'bar' }, // sem topic/resource
    });
    expect(res.statusCode).toBe(200);
  });

  it('persists the event and returns 200 with enqueued:false when no connection matches ml_user_id', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'evt-1' }]) }),
    });
    mockDb.select.mockReturnValueOnce(selectOnce([])); // findConnectionByMlUserId não encontra
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    const res = await app.inject({
      method: 'POST', url: '/v1/public/marketplace/mercadolivre/webhook',
      payload: { topic: 'orders_v2', resource: '/orders/123', user_id: 999 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not fail (still 200) when the same event is delivered twice (idempotência via UNIQUE)', async () => {
    const dup = new Error('duplicate key value violates unique constraint') as Error & { code?: string };
    dup.code = '23505';
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockRejectedValue(dup) }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/public/marketplace/mercadolivre/webhook',
      payload: { topic: 'items', resource: '/items/MLB123', user_id: 999 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('enqueues a fetch_resource job when a connection matches and the sync queue is configured', async () => {
    process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL = 'http://localhost/queue/marketplace-sync-requests';
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'evt-2' }]) }),
    });
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: 'conn-1', tenant_id: 'tenant-1' }]));
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    const res = await app.inject({
      method: 'POST', url: '/v1/public/marketplace/mercadolivre/webhook',
      payload: { topic: 'orders_v2', resource: '/orders/456', user_id: 999 },
    });
    expect(res.statusCode).toBe(200);
    delete process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL;
  });
});
