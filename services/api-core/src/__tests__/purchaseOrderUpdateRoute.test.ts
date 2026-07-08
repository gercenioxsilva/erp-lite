import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/purchase-orders/:id só pode editar um pedido em 'draft' — uma
// vez aprovado, o fornecedor pode já ter recebido o pedido, então editar
// depois disso corromperia esse rastro (mesmo princípio de
// updateSupplierInvoice()). Também cobre a correção de uma vulnerabilidade
// de SQL injection: a versão anterior montava o UPDATE via sql.raw() com
// interpolação direta de string.

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), update: vi.fn(), delete: vi.fn(), insert: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PO_ID     = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function updateChain(returningRows: unknown[]) {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve(returningRows) }) }) };
}
function deleteChain() {
  return { where: () => Promise.resolve(undefined) };
}
function insertChain() {
  return { values: () => Promise.resolve(undefined) };
}

const BASE_PAYLOAD = {
  items: [{ name: 'Item 1', unit: 'UN', quantity: 1, unit_price: 100 }],
};

describe('PATCH /v1/purchase-orders/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('atualiza um pedido em draft, substituindo header e todos os itens', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'draft' }] });
    mockDb.update.mockReturnValue(updateChain([{ id: PO_ID, status: 'draft' }]));
    mockDb.delete.mockReturnValue(deleteChain());
    mockDb.insert.mockReturnValue(insertChain());

    const res = await app.inject({
      method: 'PATCH', url: `/v1/purchase-orders/${PO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { ...BASE_PAYLOAD, notes: "observação com aspas simples: O'Brien" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('bloqueia edição de um pedido já aprovado — 422 po_not_editable, nenhuma escrita', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'approved' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/purchase-orders/${PO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('po_not_editable');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('404 quando o pedido não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/purchase-orders/${PO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(404);
  });

  it('400 quando o payload não tem itens', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/purchase-orders/${PO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/purchase-orders/${PO_ID}`, payload: BASE_PAYLOAD });
    expect(res.statusCode).toBe(401);
  });
});
