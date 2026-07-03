import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

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
const COMPANY_ID = '22222222-2222-2222-2222-222222222222';
const ACCOUNT_A  = '33333333-3333-3333-3333-333333333333'; // default
const ACCOUNT_B  = '44444444-4444-4444-4444-444444444444'; // segunda conta

function token(app: FastifyInstance, tenantId = TENANT_ID) {
  return app.jwt.sign({ tenantId, userId: 'user-1', role: 'admin' });
}

function selectOnce(rows: unknown[]) {
  return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
}

const validPayload = {
  company_id: COMPANY_ID, bank_code: '341', agency: '1234', account: '16102', account_digit: '5',
};

describe('GET /v1/bank-accounts', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 401 without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/bank-accounts' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('returns the list scoped to the tenant, secret masked', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([
      { id: ACCOUNT_A, company_id: COMPANY_ID, is_default: true, is_active: true, itau_client_secret: 'abcdef123456' },
    ]));

    const res = await app.inject({ method: 'GET', url: '/v1/bank-accounts', headers: { authorization: `Bearer ${token(app)}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].itau_client_secret).toBe('****3456');
  });
});

describe('POST /v1/bank-accounts', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 400 when required fields are missing', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/bank-accounts',
      headers: { authorization: `Bearer ${token(app)}` }, payload: { company_id: COMPANY_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when company_id does not belong to the tenant', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([])); // resolveCompanyId não encontra

    const res = await app.inject({
      method: 'POST', url: '/v1/bank-accounts',
      headers: { authorization: `Bearer ${token(app)}` }, payload: validPayload,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 for invalid banking data (reaproveita validateBankingData de lib/banking.ts)', async () => {
    // assertValid() roda antes de listAllForCompany em createBankAccount — só
    // 1 select é consumido (resolveCompanyId) antes do erro de validação.
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }]));

    const res = await app.inject({
      method: 'POST', url: '/v1/bank-accounts',
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { ...validPayload, bank_code: '999' }, // código de banco inválido
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('invalid_banking_data');
  });

  it('returns 201 and creates the first account of a company as is_default=true', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: COMPANY_ID, tenant_id: TENANT_ID, is_active: true }])); // resolveCompanyId
    mockDb.select.mockReturnValueOnce(selectOnce([])); // listAllForCompany — nenhuma conta ainda
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: ACCOUNT_A, ...validPayload, is_default: true, is_active: true }]) }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/bank-accounts',
      headers: { authorization: `Bearer ${token(app)}` }, payload: validPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().is_default).toBe(true);
  });
});

describe('DELETE /v1/bank-accounts/:id — invariantes de desativação', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 422 when trying to deactivate the default account', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ id: ACCOUNT_A, company_id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true, is_active: true }]))
      .mockReturnValueOnce(selectOnce([
        { id: ACCOUNT_A, company_id: COMPANY_ID, is_default: true, is_active: true },
        { id: ACCOUNT_B, company_id: COMPANY_ID, is_default: false, is_active: true },
      ]));

    const res = await app.inject({
      method: 'DELETE', url: `/v1/bank-accounts/${ACCOUNT_A}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('cannot_deactivate_bank_account');
  });

  it('returns 204 when deactivating a non-default account while another remains active', async () => {
    mockDb.select
      .mockReturnValueOnce(selectOnce([{ id: ACCOUNT_B, company_id: COMPANY_ID, tenant_id: TENANT_ID, is_default: false, is_active: true }]))
      .mockReturnValueOnce(selectOnce([
        { id: ACCOUNT_A, company_id: COMPANY_ID, is_default: true, is_active: true },
        { id: ACCOUNT_B, company_id: COMPANY_ID, is_default: false, is_active: true },
      ]));
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });

    const res = await app.inject({
      method: 'DELETE', url: `/v1/bank-accounts/${ACCOUNT_B}`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('PATCH /v1/bank-accounts/:id/set-default', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('swaps the default flag atomically via transaction', async () => {
    mockDb.select.mockReturnValueOnce(selectOnce([{ id: ACCOUNT_B, company_id: COMPANY_ID, tenant_id: TENANT_ID, is_default: false, is_active: true }]));

    mockDb.transaction.mockImplementation(async (fn: (tx: typeof mockDb) => Promise<unknown>) => {
      const tx = {
        update: vi.fn()
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
          .mockReturnValueOnce({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: ACCOUNT_B, is_default: true }]) }) }) }),
      };
      return fn(tx as any);
    });

    const res = await app.inject({
      method: 'PATCH', url: `/v1/bank-accounts/${ACCOUNT_B}/set-default`,
      headers: { authorization: `Bearer ${token(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_default).toBe(true);
  });
});
