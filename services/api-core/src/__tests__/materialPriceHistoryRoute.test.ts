import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

const mockDb = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const MATERIAL_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID   = '22222222-2222-2222-2222-222222222222';

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

function updateChainReturning(rows: unknown[]) {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }) };
}

function valuesChain(returningRows: unknown[] = []) {
  const p: any = Promise.resolve(undefined);
  p.onConflictDoNothing = () => ({ returning: () => Promise.resolve(returningRows) });
  p.returning = () => Promise.resolve(returningRows);
  return p;
}

describe('PATCH /v1/materials/:id — grava histórico de preço', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });
  afterEach(async () => { await app.close(); });

  it('grava material_price_history quando sale_price muda via edição manual', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ tenant_id: TENANT_ID, sale_price: '29.90', cost_price: '15.00' }]));
    mockDb.update.mockReturnValue(updateChainReturning([{ id: MATERIAL_ID, type: 'product', sale_price: '32.90', cost_price: '15.00' }]));
    mockDb.insert.mockReturnValue({ values: () => valuesChain() });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/materials/${MATERIAL_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sale_price: 32.9 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('não grava histórico quando nenhum campo de preço está no payload', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ tenant_id: TENANT_ID, sale_price: '29.90', cost_price: '15.00' }]));
    mockDb.update.mockReturnValue(updateChainReturning([{ id: MATERIAL_ID, type: 'product', name: 'Novo nome' }]));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/materials/${MATERIAL_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Novo nome' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('não grava histórico quando o preço enviado é igual ao atual', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ tenant_id: TENANT_ID, sale_price: '29.90', cost_price: '15.00' }]));
    mockDb.update.mockReturnValue(updateChainReturning([{ id: MATERIAL_ID, type: 'product', sale_price: '29.90' }]));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/materials/${MATERIAL_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sale_price: 29.9 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('retorna 404 e não grava nada quando o material não existe', async () => {
    mockDb.select.mockReturnValue(selectOnce([]));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/materials/${MATERIAL_ID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { sale_price: 32.9 },
    });

    expect(res.statusCode).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe('GET /v1/materials/:id/price-history', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });
  afterEach(async () => { await app.close(); });

  it('retorna a lista paginada, mais recente primeiro', async () => {
    const historyRows = [{
      id: 'hist-1', material_id: MATERIAL_ID,
      sale_price_before: '29.90', sale_price_after: '32.90',
      cost_price_before: null, cost_price_after: null,
      source: 'bulk_import', created_at: '2026-07-06T10:00:00.000Z',
    }];
    mockDb.select.mockReturnValueOnce({ from: () => ({ where: () => Promise.resolve([{ count: 1 }]) }) });
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(historyRows) }) }) }) }),
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/materials/${MATERIAL_ID}/price-history`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual(historyRows);
    expect(body.meta.total).toBe(1);
  });
});
