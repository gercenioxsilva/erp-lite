import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/service-orders/:id só pode editar uma OS em 'draft' — uma vez
// agendada, o técnico pode já ter recebido o link da visita (regra 38),
// então editar depois disso divergiria do que já foi comunicado a ele.
// Mesmo padrão de purchaseOrderUpdateRoute.test.ts.

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), update: vi.fn(), delete: vi.fn(), insert: vi.fn(), select: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SO_ID     = '22222222-2222-2222-2222-222222222222';

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
  title: 'Manutenção preventiva',
  type: 'maintenance',
  items: [{ description: 'Troca de filtro', quantity: 1, unit_price: 150 }],
};

describe('PATCH /v1/service-orders/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    // requireModule('service_orders') precisa do módulo habilitado pra
    // chegar na rota — mesmo padrão de serviceOrderBillingRoute.test.ts.
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('atualiza uma OS em draft, substituindo header e todos os itens', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'draft' }] });
    mockDb.update.mockReturnValue(updateChain([{ id: SO_ID, status: 'draft' }]));
    mockDb.delete.mockReturnValue(deleteChain());
    mockDb.insert.mockReturnValue(insertChain());

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('bloqueia edição de uma OS já agendada — 422 service_order_not_editable, nenhuma escrita', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'scheduled' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('service_order_not_editable');
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('404 quando a OS não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(404);
  });

  it('422 quando o título está vazio', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'draft' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/service-orders/${SO_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { ...BASE_PAYLOAD, title: '  ' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('service_order_title_required');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/service-orders/${SO_ID}`, payload: BASE_PAYLOAD });
    expect(res.statusCode).toBe(401);
  });
});
