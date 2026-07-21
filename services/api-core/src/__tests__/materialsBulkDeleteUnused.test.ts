import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/materials/bulk-delete-unused — EXCLUSÃO FÍSICA em massa (regra 69,
// revisada): zona de risco para recuperar de uma importação de planilha
// errada. Elegibilidade exige nunca ter sido referenciado em NENHUMA tabela
// que aponta pra materials com FK SET NULL/RESTRICT (não só
// inventory_movements) — senão corromperia ou bloquearia um documento real.

const mockDb = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/materials/bulk-delete-unused', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('exclui de verdade (DELETE) só os produtos nunca referenciados em nenhuma tabela relacionada, e devolve a contagem', async () => {
    let capturedQuery = '';
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      // Só a query do endpoint sob teste referencia "DELETE FROM materials" —
      // as demais chamadas capturadas aqui são de workers em background que
      // o app dispara no boot, irrelevantes pra este teste.
      if (/DELETE FROM materials/i.test(text)) capturedQuery = text;
      return { rows: /DELETE FROM materials/i.test(text) ? [{ id: 'mat-1' }, { id: 'mat-2' }] : [] };
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/bulk-delete-unused',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });
    expect(capturedQuery).toMatch(/DELETE FROM materials/i);
    // Cobertura de negócio (inventory_movements) preservada...
    expect(capturedQuery).toMatch(/inventory_movements/);
    // ...e ampliada pra toda tabela com FK SET NULL/RESTRICT/NO ACTION —
    // não só as de estoque, senão um pedido/nota/proposta/contrato/OS/PDV/
    // centro de custo/kit já existente ficaria órfão ou bloquearia o DELETE.
    expect(capturedQuery).toMatch(/order_items/);
    expect(capturedQuery).toMatch(/invoice_items/);
    expect(capturedQuery).toMatch(/simples_remessa_items/);
    expect(capturedQuery).toMatch(/service_contracts/);
    expect(capturedQuery).toMatch(/proposal_items/);
    expect(capturedQuery).toMatch(/purchase_order_items/);
    expect(capturedQuery).toMatch(/supplier_invoice_items/);
    expect(capturedQuery).toMatch(/service_order_items/);
    expect(capturedQuery).toMatch(/pos_sale_items/);
    expect(capturedQuery).toMatch(/cost_center_stock/);
    expect(capturedQuery).toMatch(/cost_center_movements/);
    expect(capturedQuery).toMatch(/material_components/);
    // Sem filtro de is_active — um produto já desativado numa tentativa
    // anterior também precisa sumir de vez no reset de emergência.
    expect(capturedQuery).not.toMatch(/is_active/);
  });

  it('devolve 0 quando não há produtos elegíveis (todos referenciados em algum documento)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/bulk-delete-unused',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 0 });
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/materials/bulk-delete-unused' });
    expect(res.statusCode).toBe(401);
  });
});
