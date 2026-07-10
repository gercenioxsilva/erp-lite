import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET /v1/orders/:id — regra 62: os itens do pedido devolvem ncm_code/cfop
// via LEFT JOIN materials, prontos pra herança em InvoiceNewPage.tsx. Antes
// disso a tela de nota tinha que recasar material_id contra uma lista de
// materiais buscada à parte, o que podia deixar NCM/CFOP vazios mesmo com o
// cadastro do produto correto (catálogo grande além do per_page da lista,
// ou dado desatualizado em memória).

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const ORDER_ID   = '22222222-2222-2222-2222-222222222222';
const MATERIAL_ID = '33333333-3333-3333-3333-333333333333';

function mockExecuteByQuery(orderRow: unknown, itemRows: unknown[]) {
  mockDb.execute.mockImplementation(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query ?? '');
    if (/order_items oi/i.test(text))                 return { rows: itemRows };
    if (/FROM orders o JOIN clients/i.test(text))     return { rows: orderRow ? [orderRow] : [] };
    return { rows: [] };
  });
}

describe('GET /v1/orders/:id — itens trazem ncm_code/cfop do JOIN com materials (regra 62)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('devolve ncm_code/cfop do cadastro do material junto com o item do pedido', async () => {
    mockExecuteByQuery(
      { id: ORDER_ID, tenant_id: TENANT_ID, client_id: 'client-1', status: 'draft' },
      [{
        id: 'item-1', order_id: ORDER_ID, material_id: MATERIAL_ID, name: 'Produto A',
        quantity: '2', unit_price: '50.00', total: '100.00',
        ncm_code: '1234.56.78', cfop: '5102',
      }],
    );

    const res = await app.inject({
      method: 'GET', url: `/v1/orders/${ORDER_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ ncm_code: '1234.56.78', cfop: '5102' });
  });

  it('item sem material vinculado: ncm_code/cfop vêm null, sem quebrar', async () => {
    mockExecuteByQuery(
      { id: ORDER_ID, tenant_id: TENANT_ID, client_id: 'client-1', status: 'draft' },
      [{
        id: 'item-1', order_id: ORDER_ID, material_id: null, name: 'Item avulso',
        quantity: '1', unit_price: '10.00', total: '10.00',
        ncm_code: null, cfop: null,
      }],
    );

    const res = await app.inject({
      method: 'GET', url: `/v1/orders/${ORDER_ID}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({ ncm_code: null, cfop: null });
  });
});
