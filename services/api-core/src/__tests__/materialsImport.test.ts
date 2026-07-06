import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Reproduz o bug relatado por um cliente real: reimportar a mesma planilha
// pra atualizar preço resultava em "0 importados, N ignorados" porque SKU
// duplicado sempre era tratado como erro, nunca como atualização. Ver regra
// correspondente no README (histórico de preço de materiais).

const mockDb = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

// insert().values() precisa ser awaitable diretamente (caso material_price_history,
// sem encadeamento) E encadeável com .onConflictDoNothing().returning() (caso
// materials/inventory) — mesma mensagem, dois formatos de uso no código real.
function valuesChain(returningRows: unknown[] = []) {
  const p: any = Promise.resolve(undefined);
  p.onConflictDoNothing = () => ({ returning: () => Promise.resolve(returningRows) });
  p.returning = () => Promise.resolve(returningRows);
  return p;
}

function insertChain(returningRows: unknown[] = []) {
  return { values: () => valuesChain(returningRows) };
}

function updateChain() {
  return { set: () => ({ where: () => Promise.resolve(undefined) }) };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return { sku: 'PROD-001', nome: 'Parafuso M6', preco_venda: '32.90', preco_custo: '16.50', ...overrides };
}

describe('POST /v1/materials/import', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('[regressão do cliente] SKU já cadastrado, sem update_existing, continua ignorado — comportamento idêntico ao de antes', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ id: 'mat-1', sale_price: '29.90', cost_price: '15.00' }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow()] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(0);
    expect(body.updated).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.errors[0].message).toBe(`SKU 'PROD-001' já cadastrado`);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('SKU já cadastrado + update_existing=true + preço diferente → atualiza e grava histórico', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ id: 'mat-1', sale_price: '29.90', cost_price: '15.00' }]));
    mockDb.update.mockReturnValue(updateChain());
    mockDb.insert.mockReturnValue({ values: () => valuesChain() });

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow()], update_existing: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(1);
    expect(body.created).toBe(0);
    expect(body.skipped).toBe(0);
    const row = body.rows[0];
    expect(row.action).toBe('updated');
    expect(row.changes.sale_price).toEqual({ from: 29.9, to: 32.9 });
    expect(row.changes.cost_price).toEqual({ from: 15, to: 16.5 });
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1); // grava material_price_history
  });

  it('SKU já cadastrado + update_existing=true + preço IGUAL → unchanged, nenhuma escrita', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ id: 'mat-1', sale_price: '32.90', cost_price: '16.50' }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow()], update_existing: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.unchanged).toBe(1);
    expect(body.updated).toBe(0);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('SKU novo continua sendo criado normalmente (regressão)', async () => {
    mockDb.select.mockReturnValue(selectOnce([])); // não existe
    mockDb.insert.mockReturnValue(insertChain([{ id: 'mat-new' }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow({ sku: 'PROD-NEW' })], update_existing: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(1);
    expect(body.imported).toBe(1); // retrocompatibilidade
    expect(body.rows[0].action).toBe('created');
  });

  it('dry_run=true nunca escreve no banco, mesmo classificando como "updated"', async () => {
    mockDb.select.mockReturnValue(selectOnce([{ id: 'mat-1', sale_price: '29.90', cost_price: '15.00' }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow()], update_existing: true, dry_run: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(1);
    expect(body.rows[0].changes.sale_price).toEqual({ from: 29.9, to: 32.9 });
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('dry_run=true também não escreve para SKU novo (classificação "created" sem insert)', async () => {
    mockDb.select.mockReturnValue(selectOnce([]));

    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [baseRow({ sku: 'PROD-NEW' })], dry_run: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('linha sem "sku" continua sendo ignorada com erro (comportamento inalterado)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/materials/import',
      payload: { tenant_id: TENANT_ID, materials: [{ nome: 'Sem SKU' }] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skipped).toBe(1);
    expect(body.errors[0].message).toBe('Coluna "sku" é obrigatória');
  });
});
