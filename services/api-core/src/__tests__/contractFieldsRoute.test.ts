import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Campos Personalizados de Contrato (migration 0072) são finas —
// mockamos o service inteiro (já testado isoladamente em
// contractFieldService.test.ts) e verificamos só o contrato HTTP: status
// codes, gate de módulo, mapeamento de erro de domínio.

vi.mock('../services/contractFieldService', () => ({
  listFieldDefinitions:      vi.fn(),
  createFieldDefinition:     vi.fn(),
  updateFieldDefinition:     vi.fn(),
  deactivateFieldDefinition: vi.fn(),
  ContractFieldDomainError: class ContractFieldDomainError extends Error {
    code: string; payload?: Record<string, unknown>;
    constructor(code: string, payload?: Record<string, unknown>) { super(code); this.code = code; this.payload = payload; }
  },
}));

const mockDb = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function mockModuleEnabled(enabled: boolean) {
  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve(enabled ? [{ enabled: true }] : []) }),
  }));
}

describe('GET /v1/contract-fields', () => {
  let app: FastifyInstance;
  let listFieldDefinitions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    listFieldDefinitions = (await import('../services/contractFieldService')).listFieldDefinitions as any;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('403 quando o módulo service_contracts não está habilitado', async () => {
    mockModuleEnabled(false);
    const res = await app.inject({
      method: 'GET', url: '/v1/contract-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(listFieldDefinitions).not.toHaveBeenCalled();
  });

  it('200 com a lista quando o módulo está habilitado', async () => {
    listFieldDefinitions.mockResolvedValue([{ id: 'def-1', label: 'Valor do Contrato' }]);
    const res = await app.inject({
      method: 'GET', url: '/v1/contract-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/contract-fields' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/contract-fields', () => {
  let app: FastifyInstance;
  let createFieldDefinition: ReturnType<typeof vi.fn>;
  let ContractFieldDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/contractFieldService');
    createFieldDefinition = mod.createFieldDefinition as any;
    ContractFieldDomainError = mod.ContractFieldDomainError;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('201 quando a definição é criada', async () => {
    createFieldDefinition.mockResolvedValue({ id: 'def-1', field_key: 'valor_do_contrato', label: 'Valor do Contrato', field_type: 'decimal' });
    const res = await app.inject({
      method: 'POST', url: '/v1/contract-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { label: 'Valor do Contrato', field_type: 'decimal' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('422 quando o domínio rejeita (ex.: chave duplicada)', async () => {
    createFieldDefinition.mockRejectedValue(new ContractFieldDomainError('field_key_duplicate', { key: 'valor_do_contrato' }));
    const res = await app.inject({
      method: 'POST', url: '/v1/contract-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { label: 'Valor do Contrato', field_type: 'decimal' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('field_key_duplicate');
  });
});

describe('DELETE /v1/contract-fields/:id', () => {
  let app: FastifyInstance;
  let deactivateFieldDefinition: ReturnType<typeof vi.fn>;
  let ContractFieldDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/contractFieldService');
    deactivateFieldDefinition = mod.deactivateFieldDefinition as any;
    ContractFieldDomainError = mod.ContractFieldDomainError;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('204 quando desativado com sucesso', async () => {
    deactivateFieldDefinition.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'DELETE', url: '/v1/contract-fields/def-1',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('404 quando o campo não existe', async () => {
    deactivateFieldDefinition.mockRejectedValue(new ContractFieldDomainError('field_not_found'));
    const res = await app.inject({
      method: 'DELETE', url: '/v1/contract-fields/def-x',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
