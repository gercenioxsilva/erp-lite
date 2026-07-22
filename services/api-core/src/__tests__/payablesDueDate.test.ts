import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/payables/:id — trava de alteração de vencimento (regra 82):
// nunca numa conta já paga, sempre validando o formato da data. Payables não
// têm boleto/banco envolvido, então não há trava equivalente à de receivables.

const state: { row: Record<string, unknown> | null } = { row: null };

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: () => ({ where: () => Promise.resolve(state.row ? [state.row] : []) }),
      })),
      update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
    },
  };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const PAYABLE_ID = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('PATCH /v1/payables/:id — alteração de vencimento', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando a conta está pendente e a data é válida', async () => {
    state.row = { id: PAYABLE_ID, status: 'pending' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('200 quando é um pagável recorrente (o vencimento é a âncora da próxima ocorrência — editar é intencional)', async () => {
    state.row = { id: PAYABLE_ID, status: 'pending', recurrence: 'monthly' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('400 quando a conta já está paga', async () => {
    state.row = { id: PAYABLE_ID, status: 'paid' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/já paga/);
  });

  it('400 quando a data está num formato inválido', async () => {
    state.row = { id: PAYABLE_ID, status: 'pending' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '15/08/2026' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 quando a conta já está cancelada (guard geral, continua valendo)', async () => {
    state.row = { id: PAYABLE_ID, status: 'cancelled' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('200 pra edição de outros campos (description) numa conta paga — a trava é só do due_date', async () => {
    state.row = { id: PAYABLE_ID, status: 'paid' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ description: 'Nova descrição' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('404 quando a conta não existe', async () => {
    state.row = null;
    const res = await app.inject({
      method: 'PATCH', url: `/v1/payables/${PAYABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(404);
  });
});
