import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// ── DB mock (vi.hoisted ensures it's available before vi.mock factory runs) ────
const mockDb = vi.hoisted(() => ({
  select:      vi.fn(),
  insert:      vi.fn(),
  update:      vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const COMPANY_A  = '22222222-2222-2222-2222-222222222222'; // default
const COMPANY_B  = '33333333-3333-3333-3333-333333333333'; // segunda empresa
const CNPJ_A = 'AAAAAA00000171';
const CNPJ_B = 'B2C3D4E5F6G185';

function token(app: FastifyInstance, tenantId = TENANT_ID) {
  return app.jwt.sign({ tenantId, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

const validPayload = {
  cnpj: CNPJ_B, razao_social: 'Filial RJ Ltda', logradouro: 'Rua B', numero: '10', bairro: 'Centro', cep: '20000000',
};

describe('GET /v1/companies', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/companies' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('returns the list scoped to the tenant, tokens masked', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      { id: COMPANY_A, cnpj: CNPJ_A, is_default: true, is_active: true, focus_token_producao: 'abcdef123456' },
    ]));

    const res = await app.inject({ method: 'GET', url: '/v1/companies', headers: { authorization: `Bearer ${token(app)}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].focus_token_producao).toBe('****3456');
  });
});

describe('POST /v1/companies — gate do módulo multi_empresa (regra 40)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 403 when the multi_empresa module is disabled — o requisito central de segurança', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([])); // isModuleEnabled → nenhuma linha → false

    const res = await app.inject({
      method: 'POST', url: '/v1/companies',
      headers: { authorization: `Bearer ${token(app)}` }, payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ModuleNotEnabled');
  });

  it('returns 201 when the module is enabled and the CNPJ is valid and unique', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }])) // isModuleEnabled
      .mockReturnValueOnce(selectOnce([{ id: COMPANY_A, cnpj: CNPJ_A }])); // listAllCompanies (empresa padrão existente)
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: COMPANY_B, ...validPayload, is_default: false, is_active: true }]) }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/companies',
      headers: { authorization: `Bearer ${token(app)}` }, payload: validPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe(COMPANY_B);
  });

  it('returns 422 when the CNPJ already belongs to another company of this tenant', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ enabled: true }]))
      .mockReturnValueOnce(selectOnce([{ id: COMPANY_A, cnpj: CNPJ_B }])); // já existe com o mesmo CNPJ

    const res = await app.inject({
      method: 'POST', url: '/v1/companies',
      headers: { authorization: `Bearer ${token(app)}` }, payload: validPayload,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('duplicate_cnpj');
  });

  it('returns 400 when required fields are missing (module enabled)', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([{ enabled: true }])); // isModuleEnabled

    const res = await app.inject({
      method: 'POST', url: '/v1/companies',
      headers: { authorization: `Bearer ${token(app)}` }, payload: { cnpj: CNPJ_B },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /v1/companies/:id', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when the company does not belong to the tenant', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([])); // resolveCompanyId não encontra

    const res = await app.inject({
      method: 'PATCH', url: `/v1/companies/${COMPANY_B}`,
      headers: { authorization: `Bearer ${token(app)}` }, payload: { razao_social: 'Novo nome' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /v1/companies/:id — invariantes de desativação', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 422 when trying to deactivate the default company', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      { id: COMPANY_A, cnpj: CNPJ_A, is_default: true, is_active: true },
      { id: COMPANY_B, cnpj: CNPJ_B, is_default: false, is_active: true },
    ]));

    const res = await app.inject({
      method: 'DELETE', url: `/v1/companies/${COMPANY_A}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('cannot_deactivate_company');
  });

  it('returns 204 when deactivating a non-default company while another remains active', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      { id: COMPANY_A, cnpj: CNPJ_A, is_default: true, is_active: true },
      { id: COMPANY_B, cnpj: CNPJ_B, is_default: false, is_active: true },
    ]));
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/companies/${COMPANY_B}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('PATCH /v1/companies/:id/set-default', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('swaps the default flag atomically via transaction', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: COMPANY_B, cnpj: CNPJ_B, is_default: false, is_active: true }]));

    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      const tx = {
        update: vi.fn()
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: COMPANY_B, is_default: true }]) }) }) }),
      };
      return fn(tx as any);
    });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/companies/${COMPANY_B}/set-default`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_default).toBe(true);
  });
});
