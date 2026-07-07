import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/supplier-invoices/:id só pode editar uma nota em 'draft' — uma
// vez confirmada (mesmo em divergência), estoque/payable já foram gerados a
// partir dos dados atuais, então editar depois disso a corromperia.

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), update: vi.fn(), delete: vi.fn(), insert: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SI_ID     = '22222222-2222-2222-2222-222222222222';

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
  total: 100, subtotal: 100,
  items: [{ name: 'Item 1', unit: 'UN', quantity: 1, unit_price: 100 }],
};

describe('PATCH /v1/supplier-invoices/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('atualiza uma nota em draft, substituindo todos os itens', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'draft' }] });
    mockDb.update.mockReturnValue(updateChain([{ id: SI_ID, status: 'draft' }]));
    mockDb.delete.mockReturnValue(deleteChain());
    mockDb.insert.mockReturnValue(insertChain());

    const res = await app.inject({
      method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('bloqueia edição de uma nota já confirmada — 422 si_not_editable, nenhuma escrita', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'confirmed' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('si_not_editable');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('bloqueia edição de uma nota em divergência (também já gerou estoque/payable)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'divergence' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('si_not_editable');
  });

  it('404 quando a nota não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(404);
  });

  it('400 quando o payload não tem itens', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { total: 100, subtotal: 100, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/supplier-invoices/${SI_ID}`, payload: BASE_PAYLOAD });
    expect(res.statusCode).toBe(401);
  });
});
