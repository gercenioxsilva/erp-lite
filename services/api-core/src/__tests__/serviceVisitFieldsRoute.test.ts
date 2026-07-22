import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// Rotas de Campos Personalizados de Visita Técnica (migration 0088) — mesmo
// molde de contractFieldsRoute.test.ts: mockamos o service inteiro (já
// testado isoladamente em serviceVisitFieldService.test.ts) e verificamos só
// o contrato HTTP. Diferente de contrato, o gate de permissão é
// service_visit_fields:view/manage (admin-only, nunca service_orders:*).

vi.mock('../services/serviceVisitFieldService', () => ({
  listVisitFieldDefinitions:      vi.fn(),
  createVisitFieldDefinition:     vi.fn(),
  updateVisitFieldDefinition:     vi.fn(),
  deactivateVisitFieldDefinition: vi.fn(),
  ServiceVisitFieldDomainError: class ServiceVisitFieldDomainError extends Error {
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

function authToken(app: FastifyInstance, role = 'admin') {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role });
}

function mockModuleEnabled(enabled: boolean) {
  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve(enabled ? [{ enabled: true }] : []) }),
  }));
}

describe('GET /v1/service-visit-fields', () => {
  let app: FastifyInstance;
  let listVisitFieldDefinitions: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    listVisitFieldDefinitions = (await import('../services/serviceVisitFieldService')).listVisitFieldDefinitions as any;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('403 quando o módulo service_orders não está habilitado', async () => {
    mockModuleEnabled(false);
    const res = await app.inject({
      method: 'GET', url: '/v1/service-visit-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(403);
    expect(listVisitFieldDefinitions).not.toHaveBeenCalled();
  });

  it('200 com a lista quando o módulo está habilitado (admin)', async () => {
    listVisitFieldDefinitions.mockResolvedValue([{ id: 'def-1', label: 'Tem internet no local?' }]);
    const res = await app.inject({
      method: 'GET', url: '/v1/service-visit-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/service-visit-fields' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/service-visit-fields', () => {
  let app: FastifyInstance;
  let createVisitFieldDefinition: ReturnType<typeof vi.fn>;
  let ServiceVisitFieldDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/serviceVisitFieldService');
    createVisitFieldDefinition = mod.createVisitFieldDefinition as any;
    ServiceVisitFieldDomainError = mod.ServiceVisitFieldDomainError;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('201 quando a definição é criada (admin)', async () => {
    createVisitFieldDefinition.mockResolvedValue({ id: 'def-1', field_key: 'tem_internet_no_local', label: 'Tem internet no local?', field_type: 'boolean' });
    const res = await app.inject({
      method: 'POST', url: '/v1/service-visit-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { label: 'Tem internet no local?', field_type: 'boolean' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('422 quando o domínio rejeita (ex.: chave duplicada)', async () => {
    createVisitFieldDefinition.mockRejectedValue(new ServiceVisitFieldDomainError('field_key_duplicate', { key: 'tem_internet_no_local' }));
    const res = await app.inject({
      method: 'POST', url: '/v1/service-visit-fields',
      headers: { authorization: `Bearer ${authToken(app)}` },
      payload: { label: 'Tem internet no local?', field_type: 'boolean' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('field_key_duplicate');
  });
});

describe('DELETE /v1/service-visit-fields/:id', () => {
  let app: FastifyInstance;
  let deactivateVisitFieldDefinition: ReturnType<typeof vi.fn>;
  let ServiceVisitFieldDomainError: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../services/serviceVisitFieldService');
    deactivateVisitFieldDefinition = mod.deactivateVisitFieldDefinition as any;
    ServiceVisitFieldDomainError = mod.ServiceVisitFieldDomainError;
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('204 quando desativado com sucesso', async () => {
    deactivateVisitFieldDefinition.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'DELETE', url: '/v1/service-visit-fields/def-1',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('404 quando o campo não existe', async () => {
    deactivateVisitFieldDefinition.mockRejectedValue(new ServiceVisitFieldDomainError('field_not_found'));
    const res = await app.inject({
      method: 'DELETE', url: '/v1/service-visit-fields/def-x',
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('admin-only — technician (portal:access) nunca acessa a configuração', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockModuleEnabled(true);
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('403 para role=technician (só tem portal:access, nunca service_visit_fields:*)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/service-visit-fields',
      headers: { authorization: `Bearer ${authToken(app, 'technician')}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
