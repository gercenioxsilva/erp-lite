import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/invoices — herança de seller_id/cost_center_id do pedido de
// origem (regra 61). Antes só seller_id herdava; cost_center_id nunca
// herdava, o que também quebrava a baixa de estoque na autorização
// (gated em invoices.cost_center_id).

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));
const state = vi.hoisted(() => ({ actualDb: undefined as any }));

let orderRows: unknown[] = [];
let insertedInvoice: Record<string, unknown> | undefined;

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  state.actualDb = actual;
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === actual.orders ? orderRows : []),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID  = '22222222-2222-2222-2222-222222222222';
const ORDER_ID   = '33333333-3333-3333-3333-333333333333';
const SELLER_ID  = '44444444-4444-4444-4444-444444444444';
const CC_ID      = '55555555-5555-5555-5555-555555555555';

const validItems = [{ name: 'Item 1', quantity: 1, unit_price: 100 }];

describe('POST /v1/invoices — herança de seller_id/cost_center_id do pedido (regra 61)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    orderRows = [];
    insertedInvoice = undefined;
    mockDb.transaction.mockImplementation(async (fn: any) => {
      const tx = {
        insert: vi.fn((table: unknown) => ({
          values: (data: Record<string, unknown>) => {
            if (table === state.actualDb.invoices) insertedInvoice = data;
            return { returning: vi.fn().mockResolvedValue([{ id: 'invoice-1', status: 'draft', serie: '1' }]) };
          },
        })),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return fn(tx as any);
    });
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('sem order_id: seller_id e cost_center_id ficam null quando não informados', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    expect(insertedInvoice).toMatchObject({ seller_id: null, cost_center_id: null });
  });

  it('com order_id e sem seller_id/cost_center_id explícitos: herda os dois do pedido', async () => {
    orderRows = [{ seller_id: SELLER_ID, cost_center_id: CC_ID }];
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems, order_id: ORDER_ID },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    expect(insertedInvoice).toMatchObject({ seller_id: SELLER_ID, cost_center_id: CC_ID });
  });

  it('com order_id mas seller_id/cost_center_id explícitos no body: body prevalece sobre o pedido', async () => {
    orderRows = [{ seller_id: SELLER_ID, cost_center_id: CC_ID }];
    const explicitSeller = '66666666-6666-6666-6666-666666666666';
    const explicitCc     = '77777777-7777-7777-7777-777777777777';
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: {
        tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems, order_id: ORDER_ID,
        seller_id: explicitSeller, cost_center_id: explicitCc,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    expect(insertedInvoice).toMatchObject({ seller_id: explicitSeller, cost_center_id: explicitCc });
  });

  it('pedido sem seller_id/cost_center_id preenchidos: nota fica com null (sem quebrar)', async () => {
    orderRows = [{ seller_id: null, cost_center_id: null }];
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems, order_id: ORDER_ID },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(201);
    expect(insertedInvoice).toMatchObject({ seller_id: null, cost_center_id: null });
  });
});
