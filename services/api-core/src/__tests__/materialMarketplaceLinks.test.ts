import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

const mockSqsSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock('../lib/sqsClient', () => ({
  getSqsClient: () => ({ send: mockSqsSend }),
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

const TENANT_ID    = '11111111-1111-1111-1111-111111111111';
const MATERIAL_ID  = '22222222-2222-2222-2222-222222222222';
const CONNECTION_ID = '33333333-3333-3333-3333-333333333333';
const LINK_ID      = '44444444-4444-4444-4444-444444444444';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

const moduleEnabled = () => selectOnce([{ enabled: true }]);

describe('POST /v1/materials/:id/marketplace-links', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 403 when the mercadolivre module is disabled', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([]));
    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: { connection_id: CONNECTION_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when connection_id is missing', async () => {
    mockDb.select.mockReturnValueOnce(moduleEnabled());
    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the material does not belong to the tenant', async () => {
    mockDb.select
      .mockReturnValueOnce(moduleEnabled())
      .mockReturnValueOnce(selectOnce([])); // materials lookup vazio

    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: { connection_id: CONNECTION_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 201 and creates the link when everything is owned by the tenant', async () => {
    mockDb.select
      .mockReturnValueOnce(moduleEnabled())
      .mockReturnValueOnce(selectOnce([{ id: MATERIAL_ID }]))     // materials
      .mockReturnValueOnce(selectOnce([{ id: CONNECTION_ID }]));  // marketplaceConnections
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: LINK_ID, status: 'pending' }]) }),
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: { connection_id: CONNECTION_ID },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending');
  });
});

describe('DELETE /v1/materials/:id/marketplace-links/:linkId', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when the link does not belong to the tenant (never a physical delete)', async () => {
    mockDb.select.mockReturnValueOnce(moduleEnabled()).mockReturnValueOnce(selectOnce([]));
    const res = await app.inject({
      method: 'DELETE', url: `/v1/materials/${MATERIAL_ID}/marketplace-links/${LINK_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 204 and soft-closes the link (status=closed)', async () => {
    mockDb.select.mockReturnValueOnce(moduleEnabled()).mockReturnValueOnce(selectOnce([{ id: LINK_ID }]));
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set: setMock });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/materials/${MATERIAL_ID}/marketplace-links/${LINK_ID}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(204);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
  });
});

describe('POST /v1/materials/:id/marketplace-links/:linkId/sync', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); delete process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL; });

  it('does not throw and reports enqueued:false when the sync queue is not configured (Fase 2 ainda não existe)', async () => {
    mockDb.select.mockReturnValueOnce(moduleEnabled()).mockReturnValueOnce(selectOnce([{ id: LINK_ID, connection_id: CONNECTION_ID, material_id: MATERIAL_ID }]));

    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links/${LINK_ID}/sync`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enqueued).toBe(false);
  });

  it('enqueues sync_material with connection tokens + material price/stock embedded, when the queue is configured (Fase 2)', async () => {
    process.env.MARKETPLACE_SYNC_REQUESTS_QUEUE_URL = 'http://localhost/queue/marketplace-sync-requests';

    mockDb.select
      .mockReturnValueOnce(moduleEnabled())
      .mockReturnValueOnce(selectOnce([{
        id: LINK_ID, connection_id: CONNECTION_ID, material_id: MATERIAL_ID,
        ml_item_id: 'MLB1', ml_variation_id: null, sync_price: true, sync_stock: true,
      }])) // getOwnedLink
      .mockReturnValueOnce(selectOnce([{
        id: CONNECTION_ID, access_token: 'tok-abc', refresh_token: 'ref-abc',
        token_expires_at: new Date('2026-01-01T00:00:00Z'),
      }])) // marketplaceConnections
      .mockReturnValueOnce(selectOnce([{ sale_price: '99.90' }])) // materials
      .mockReturnValueOnce(selectOnce([{ quantity: '10.000' }])); // inventory
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    const res = await app.inject({
      method: 'POST', url: `/v1/materials/${MATERIAL_ID}/marketplace-links/${LINK_ID}/sync`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enqueued).toBe(true);
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);
    expect(sentBody).toMatchObject({
      type: 'sync_material', tenant_id: TENANT_ID, connection_id: CONNECTION_ID, link_id: LINK_ID,
      ml_item_id: 'MLB1', sync_price: true, sync_stock: true,
      price: '99.90', available_quantity: 10,
      connection: { access_token: 'tok-abc', refresh_token: 'ref-abc' },
    });
  });
});
