import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// PATCH /v1/projects/:id só pode editar um projeto em 'draft' — mesmo padrão
// de PATCH /purchase-orders/:id e PATCH /service-orders/:id.

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), update: vi.fn(), select: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function updateChain(returningRows: unknown[]) {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve(returningRows) }) }) };
}

const BASE_PAYLOAD = { name: 'Reforma Loja A', total_value: 15000 };

describe('PATCH /v1/projects/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    // requireModule('projects') precisa do módulo habilitado pra chegar na
    // rota — mesmo padrão de serviceOrderBillingRoute.test.ts.
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('atualiza um projeto em draft', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'draft' }] });
    mockDb.update.mockReturnValue(updateChain([{ id: PROJECT_ID, status: 'draft', name: BASE_PAYLOAD.name }]));

    const res = await app.inject({
      method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('bloqueia edição de um projeto já iniciado — 422 project_not_editable', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ status: 'in_progress' }] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('project_not_editable');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('404 quando o projeto não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });

    expect(res.statusCode).toBe(404);
  });

  it('422 quando o nome está vazio', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { name: '  ', total_value: 100 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('project_name_required');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`, payload: BASE_PAYLOAD });
    expect(res.statusCode).toBe(401);
  });

  it('403 quando o módulo projects não está habilitado para o tenant', async () => {
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const res = await app.inject({
      method: 'PATCH', url: `/v1/projects/${PROJECT_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: BASE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });
});
