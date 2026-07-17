import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/projects (criação, gera number sequencial) e GET /v1/projects
// (listagem, já com o valor consumido agregado por projeto).

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), insert: vi.fn(), select: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function insertChain(returningRows: unknown[]) {
  return { values: () => ({ returning: () => Promise.resolve(returningRows) }) };
}

describe('POST /v1/projects', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('cria um projeto em draft com number sequencial gerado', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ n: '1' }] });
    mockDb.insert.mockReturnValue(insertChain([{ id: 'proj-1', number: '00001', status: 'draft' }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/projects',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { name: 'Reforma Loja A', total_value: 15000 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().number).toBe('00001');
  });

  it('422 quando o nome está vazio', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/projects',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { name: '', total_value: 100 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('project_name_required');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('403 quando o módulo projects não está habilitado', async () => {
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const res = await app.inject({
      method: 'POST', url: '/v1/projects',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { name: 'X', total_value: 100 },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/projects', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ enabled: true }]) }) });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('lista projetos com o valor consumido agregado', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/COUNT/i.test(text)) return { rows: [{ count: '1' }] };
      return { rows: [{ id: 'proj-1', number: '00001', name: 'Reforma Loja A', total_value: '15000.00', status: 'draft', consumed_value: 0 }] };
    });

    const res = await app.inject({
      method: 'GET', url: '/v1/projects',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });
});
