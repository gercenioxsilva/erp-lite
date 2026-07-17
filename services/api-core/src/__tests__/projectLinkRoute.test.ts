import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { orders, serviceOrders, projectProfessionals } from '../db';

// Vincular/desvincular pedidos de venda e ordens de serviço a um projeto
// (POST|DELETE /v1/projects/:id/orders e /service-orders) e alocar/remover
// profissionais (POST|DELETE /v1/projects/:id/professionals) — rotas
// próprias do projeto, nunca tocam PATCH /orders/:id ou /service-orders/:id.

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const ORDER_ID   = '44444444-4444-4444-4444-444444444444';
const SO_ID      = '55555555-5555-5555-5555-555555555555';

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), update: vi.fn(), insert: vi.fn(), select: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function textOf(query: any): string {
  return JSON.stringify(query?.queryChunks ?? query ?? '');
}

describe('POST|DELETE /v1/projects/:id/orders', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    // Toda chamada de assertProjectBelongsToTenant busca "FROM projects" —
    // sempre resolve o projeto existente, salvo quando o teste sobrescrever.
    mockDb.execute.mockImplementation(async (query: any) => {
      if (/FROM projects/i.test(textOf(query))) return { rows: [{ id: PROJECT_ID }] };
      return { rows: [] };
    });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('vincula um pedido existente ao projeto', async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orders) {
        return { set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: ORDER_ID }]) }) }) };
      }
      throw new Error('unexpected table');
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/orders`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { order_id: ORDER_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(mockDb.update).toHaveBeenCalledWith(orders);
  });

  it('404 quando o pedido não existe/não pertence ao tenant', async () => {
    mockDb.update.mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/orders`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { order_id: ORDER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('order_not_found');
  });

  it('400 sem order_id no body', async () => {
    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/orders`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('desvincula um pedido do projeto', async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === orders) return { set: () => ({ where: () => Promise.resolve(undefined) }) };
      throw new Error('unexpected table');
    });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/projects/${PROJECT_ID}/orders/${ORDER_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledWith(orders);
  });
});

describe('POST|DELETE /v1/projects/:id/service-orders', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    mockDb.execute.mockImplementation(async (query: any) => {
      if (/FROM projects/i.test(textOf(query))) return { rows: [{ id: PROJECT_ID }] };
      return { rows: [] };
    });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('vincula uma OS existente ao projeto', async () => {
    mockDb.update.mockImplementation((table: unknown) => {
      if (table === serviceOrders) {
        return { set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: SO_ID }]) }) }) };
      }
      throw new Error('unexpected table');
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/service-orders`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { service_order_id: SO_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(mockDb.update).toHaveBeenCalledWith(serviceOrders);
  });

  it('404 quando a OS não existe/não pertence ao tenant', async () => {
    mockDb.update.mockReturnValue({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/service-orders`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { service_order_id: SO_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('service_order_not_found');
  });
});

describe('POST|DELETE /v1/projects/:id/professionals', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('aloca um técnico ao projeto com % de comissão informativo', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ id: PROJECT_ID }] });
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === projectProfessionals) {
        return { values: () => ({ returning: () => Promise.resolve([{ id: 'alloc-1', commission_pct: '5.00' }]) }) };
      }
      throw new Error('unexpected table');
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/professionals`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { professional_type: 'technician', technician_id: 'tech-1', commission_pct: 5 },
    });

    expect(res.statusCode).toBe(201);
  });

  it('422 quando aloca com tipo=technician mas sem technician_id (validação de domínio)', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ id: PROJECT_ID }] });

    const res = await app.inject({
      method: 'POST', url: `/v1/projects/${PROJECT_ID}/professionals`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { professional_type: 'technician', commission_pct: 5 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('project_professional_technician_required');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('remove uma alocação existente', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ id: 'alloc-1' }] });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/projects/${PROJECT_ID}/professionals/alloc-1`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('404 ao remover uma alocação inexistente', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/projects/${PROJECT_ID}/professionals/alloc-404`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
