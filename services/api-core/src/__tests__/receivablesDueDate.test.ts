import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/receivables/:id — trava de alteração de vencimento (regra 82):
// nunca numa conta já paga, nunca com boleto emitido (dessincronizaria do
// banco), sempre validando o formato da data antes de tocar o Postgres.

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

const TENANT_ID      = '11111111-1111-1111-1111-111111111111';
const RECEIVABLE_ID  = '22222222-2222-2222-2222-222222222222';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('PATCH /v1/receivables/:id — alteração de vencimento', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('200 quando a conta está pendente e a data é válida', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'pending', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('400 quando a conta já está paga', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'paid', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/já paga/);
  });

  it('400 quando já existe boleto emitido para a conta', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'pending', boleto_id: 'boleto-1' };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/boleto/);
  });

  it('400 quando a data está num formato inválido', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'pending', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '15/08/2026' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 quando a data não existe no calendário (32/13, 30 de fevereiro)', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'pending', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-02-30' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 quando a conta já está cancelada (guard geral, continua valendo pra due_date também)', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'cancelled', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('200 pra edição de outros campos (description) numa conta paga — a trava é só do due_date', async () => {
    state.row = { id: RECEIVABLE_ID, status: 'paid', boleto_id: null };
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ description: 'Nova descrição' }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('404 quando a conta não existe', async () => {
    state.row = null;
    const res = await app.inject({
      method: 'PATCH', url: `/v1/receivables/${RECEIVABLE_ID}`,
      headers: { authorization: `Bearer ${token(app)}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ due_date: '2026-08-15' }),
    });
    expect(res.statusCode).toBe(404);
  });
});
