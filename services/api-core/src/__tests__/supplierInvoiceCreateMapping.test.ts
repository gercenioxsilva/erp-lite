import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/supplier-invoices recebia o payload snake_case (supplier_id,
// purchase_order_id, nfe_key, items[].material_id, ...) e repassava com
// `{ ...b, tenantId, createdBy }` direto pro service, que só lê campos
// camelCase (supplierId, purchaseOrderId, nfeKey, items[].materialId).
// Resultado: fornecedor, Pedido de Compra e material do item nunca eram
// persistidos de fato — a causa raiz de "não é possível associar Pedido de
// Compra" e de itens nunca ficarem vinculados a um material (regra 47).

const mockDb = vi.hoisted(() => ({ insert: vi.fn(), transaction: vi.fn(async (cb: any) => cb(mockDb)) }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/supplier-invoices — mapeamento snake_case → camelCase', () => {
  let app: FastifyInstance;
  let invoiceInsertData: Record<string, unknown> | undefined;
  let itemInsertData: Record<string, unknown>[];

  beforeEach(async () => {
    vi.clearAllMocks();
    invoiceInsertData = undefined;
    itemInsertData = [];
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    mockDb.insert.mockImplementation((_table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        if ('supplier_invoice_id' in data) {
          itemInsertData.push(data);
          return Promise.resolve(undefined);
        }
        invoiceInsertData = data;
        return { returning: async () => [{ id: 'si-1', ...data }] };
      },
    }));
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('persiste supplier_id, purchase_order_id, nfe_key e material_id do item', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: {
        supplier_id:       'sup-1',
        supplier_name:     'Fornecedor X',
        purchase_order_id: 'po-1',
        nfe_key:           '1'.repeat(44),
        nfe_number:        '123',
        total:             100,
        subtotal:          100,
        installments:      1,
        items: [{ material_id: 'mat-1', name: 'Parafuso', unit: 'UN', quantity: 10, unit_price: 10 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(invoiceInsertData?.supplier_id).toBe('sup-1');
    expect(invoiceInsertData?.purchase_order_id).toBe('po-1');
    expect(invoiceInsertData?.nfe_key).toBe('1'.repeat(44));
    expect(itemInsertData).toHaveLength(1);
    expect(itemInsertData[0].material_id).toBe('mat-1');
  });

  it('installments é repassado e persistido', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/supplier-invoices',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: {
        total: 300, subtotal: 300, installments: 3,
        items: [{ name: 'Item 1', unit: 'UN', quantity: 1, unit_price: 300 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(invoiceInsertData?.installments).toBe(3);
  });
});
