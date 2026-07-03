import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// GET|PATCH /v1/tenant — campos bancários delegados para bankAccountService
// (regra 41), contrato de request/response inalterado para clientes legados.

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

let accountRows: unknown[] = [];
let companyRows: unknown[] = [];
let tenantRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === actual.bankAccounts) return Promise.resolve(accountRows);
        if (table === actual.nfeConfigs)   return Promise.resolve(companyRows);
        if (table === actual.tenants)      return Promise.resolve(tenantRows);
        return Promise.resolve([]);
      },
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const ACCOUNT_ID = '33333333-3333-3333-3333-333333333333';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('GET /v1/tenant — campos bancários vêm da conta padrão, segredo mascarado', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    tenantRows = [{ id: TENANT_ID, company_name: 'Empresa Teste' }];
    companyRows = [{ id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true }];
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('retorna itau_client_secret mascarado (correção da inconsistência do endpoint legado)', async () => {
    accountRows = [{
      id: ACCOUNT_ID, company_id: COMPANY_ID, is_default: true, is_active: true,
      bank_code: '341', agency: '1234', account: '16102', account_digit: '5',
      billing_provider: 'itau', billing_days_to_expire: 30,
      itau_client_id: 'client-id', itau_client_secret: 'supersecretvalue1234',
    }];

    const res = await app.inject({ method: 'GET', url: '/v1/tenant', headers: { authorization: `Bearer ${token(app)}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bank_code).toBe('341');
    expect(body.itau_client_secret).toBe('****1234');
  });

  it('sem conta bancária cadastrada, retorna os campos bancários como null (sem erro)', async () => {
    accountRows = [];
    const res = await app.inject({ method: 'GET', url: '/v1/tenant', headers: { authorization: `Bearer ${token(app)}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bank_code).toBeNull();
  });
});

describe('PATCH /v1/tenant — campos bancários delegados para bankAccountService', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.clearAllMocks();
    companyRows = [{ id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true }];
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); });

  it('cria a conta padrão quando o tenant envia dados bancários pela primeira vez', async () => {
    accountRows = []; // getDefaultBankAccount não encontra -> upsert cria
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: ACCOUNT_ID, is_default: true }]) }),
    });

    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenant',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { bank_code: '341', agency: '1234', account: '16102', account_digit: '5' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('retorna 400 para bank_code inválido (validação reaproveitada de lib/banking.ts)', async () => {
    accountRows = [];
    const res = await app.inject({
      method: 'PATCH', url: '/v1/tenant',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { bank_code: '999', agency: '1234', account: '16102', account_digit: '5' },
    });
    expect(res.statusCode).toBe(400);
  });
});
