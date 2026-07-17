import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/materials/bulk-deactivate — desativa (is_active=false) todos os
// produtos ativos do tenant sem movimentação de estoque. Nunca um DELETE
// físico (regra 8) — mesmo soft-delete de sempre, só que em massa.

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/materials/bulk-deactivate', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('desativa só os produtos sem movimentação e devolve a contagem', async () => {
    let capturedQuery = '';
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      // Só a query do endpoint sob teste referencia materials+is_active — as
      // demais chamadas capturadas aqui são de workers em background que o
      // app dispara no boot (contractBilling, recurringPayables, etc.),
      // irrelevantes pra este teste.
      if (/UPDATE materials/i.test(text)) capturedQuery = text;
      return { rows: /UPDATE materials/i.test(text) ? [{ id: 'mat-1' }, { id: 'mat-2' }] : [] };
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/bulk-deactivate',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deactivated: 2 });
    expect(capturedQuery).toMatch(/NOT EXISTS/);
    expect(capturedQuery).toMatch(/inventory_movements/);
  });

  it('devolve 0 quando não há produtos elegíveis (todos têm movimentação)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/bulk-deactivate',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deactivated: 0 });
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/materials/bulk-deactivate' });
    expect(res.statusCode).toBe(401);
  });
});
