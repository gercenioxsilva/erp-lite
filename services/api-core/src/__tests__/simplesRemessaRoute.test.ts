import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Simples Remessa são finas — mockamos o service inteiro (já
// testado isoladamente em simplesRemessaService.test.ts) e verificamos só o
// contrato HTTP: status codes, mapeamento de erro de domínio, autenticação.

vi.mock('../services/simplesRemessaService', () => ({
  createSimplesRemessa: vi.fn(),
  emitSimplesRemessa:   vi.fn(),
  registrarRetorno:     vi.fn(),
  SimplesRemessaDomainError: class SimplesRemessaDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const SR_ID     = '22222222-2222-2222-2222-222222222222';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) };
}

describe('POST /v1/simples-remessas', () => {
  let app: FastifyInstance;
  let createSimplesRemessa: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });
    createSimplesRemessa = (await import('../services/simplesRemessaService')).createSimplesRemessa as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('400 sem client_id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/simples-remessas',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { motivo: 'conserto', items: [{ name: 'Item', quantity: 1, unit_price: 10 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(createSimplesRemessa).not.toHaveBeenCalled();
  });

  it('400 sem itens', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/simples-remessas',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { motivo: 'conserto', client_id: 'client-1', items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('201 quando tudo ok', async () => {
    createSimplesRemessa.mockResolvedValue({ id: SR_ID, status: 'draft', cfop: '5915' });
    const res = await app.inject({
      method: 'POST', url: '/v1/simples-remessas',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { motivo: 'conserto', client_id: 'client-1', items: [{ name: 'Item', quantity: 1, unit_price: 10 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(SR_ID);
  });

  it('422 quando o service lança erro de domínio', async () => {
    const { SimplesRemessaDomainError } = await import('../services/simplesRemessaService');
    createSimplesRemessa.mockRejectedValue(new (SimplesRemessaDomainError as any)('remessa_motivo_invalido'));
    const res = await app.inject({
      method: 'POST', url: '/v1/simples-remessas',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { motivo: 'venda', client_id: 'client-1', items: [{ name: 'Item', quantity: 1, unit_price: 10 }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('remessa_motivo_invalido');
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/simples-remessas',
      payload: { motivo: 'conserto', client_id: 'client-1', items: [{ name: 'Item', quantity: 1, unit_price: 10 }] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/simples-remessas/:id/emit', () => {
  let app: FastifyInstance;
  let emitSimplesRemessa: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });
    emitSimplesRemessa = (await import('../services/simplesRemessaService')).emitSimplesRemessa as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('202 quando emitido com sucesso', async () => {
    emitSimplesRemessa.mockResolvedValue({ id: SR_ID, status: 'processing' });
    const res = await app.inject({
      method: 'POST', url: `/v1/simples-remessas/${SR_ID}/emit`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('processing');
  });

  it('422 quando a remessa não pode ser emitida (transição inválida)', async () => {
    const { SimplesRemessaDomainError } = await import('../services/simplesRemessaService');
    emitSimplesRemessa.mockRejectedValue(new (SimplesRemessaDomainError as any)('invalid_remessa_transition'));
    const res = await app.inject({
      method: 'POST', url: `/v1/simples-remessas/${SR_ID}/emit`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /v1/simples-remessas/:id/retorno', () => {
  let app: FastifyInstance;
  let registrarRetorno: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });
    registrarRetorno = (await import('../services/simplesRemessaService')).registrarRetorno as any;
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('201 quando o retorno é registrado', async () => {
    registrarRetorno.mockResolvedValue({ id: 'retorno-1', parent_remessa_id: SR_ID, status: 'draft' });
    const res = await app.inject({
      method: 'POST', url: `/v1/simples-remessas/${SR_ID}/retorno`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().parent_remessa_id).toBe(SR_ID);
  });

  it('422 quando o motivo não admite retorno', async () => {
    const { SimplesRemessaDomainError } = await import('../services/simplesRemessaService');
    registrarRetorno.mockRejectedValue(new (SimplesRemessaDomainError as any)('remessa_motivo_sem_retorno'));
    const res = await app.inject({
      method: 'POST', url: `/v1/simples-remessas/${SR_ID}/retorno`,
      headers: { authorization: `Bearer ${authToken(app)}` }, payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('remessa_motivo_sem_retorno');
  });
});

describe('GET /v1/simples-remessas', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('retorna a lista e a tabela de motivos suportados', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? '');
      if (/COUNT/i.test(text)) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    const res = await app.inject({
      method: 'GET', url: '/v1/simples-remessas',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.motivos).toContain('conserto');
  });

  it('404 na busca de detalhe quando não encontrada', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    const res = await app.inject({
      method: 'GET', url: `/v1/simples-remessas/${SR_ID}`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
