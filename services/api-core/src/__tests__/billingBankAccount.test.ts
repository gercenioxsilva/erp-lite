import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/receivables/:id/emit-boleto — resolução de conta bancária (regra 41).
// Prova de regressão (tenant com 1 conta só emite exatamente como antes) +
// prova do fix (bank_account_id explícito é honrado no snapshot e na mensagem SQS).

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

let accountRows: unknown[] = [];
let companyRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === actual.bankAccounts) return Promise.resolve(accountRows);
        if (table === actual.nfeConfigs)   return Promise.resolve(companyRows);
        return Promise.resolve([]);
      },
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID    = '11111111-1111-1111-1111-111111111111';
const RECEIVABLE_ID = '22222222-2222-2222-2222-222222222222';
const ACCOUNT_DEFAULT = '33333333-3333-3333-3333-333333333333';
const ACCOUNT_OTHER   = '44444444-4444-4444-4444-444444444444';
const COMPANY_ID = '55555555-5555-5555-5555-555555555555';

function token(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function receivableRow() {
  return {
    id: RECEIVABLE_ID, tenant_id: TENANT_ID, status: 'pending', boleto_id: null,
    amount: '150.00', due_date: '2026-08-01', description: 'Serviço prestado',
  };
}

describe('POST /v1/receivables/:id/emit-boleto — resolução de conta bancária (regra 41)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    accountRows = [];
    companyRows = [{ id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true }];
    process.env.BILLING_REQUESTS_QUEUE_URL = 'http://localhost/queue/billing-requests';

    // Discrimina por tabela (não por ordem de chamada) — robusto contra
    // qualquer outra query de background disparada durante buildApp().
    mockDb.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: async () => {
          const actual = await import('../db');
          if (table === (actual as any).receivables)  return [receivableRow()];
          if (table === (actual as any).bankAccounts) return accountRows;
          if (table === (actual as any).nfeConfigs)   return companyRows;
          return [];
        },
      }),
    }));

    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'boleto-1', receivable_id: RECEIVABLE_ID }]) }),
    });
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.BILLING_REQUESTS_QUEUE_URL;
  });

  it('[regressão] sem bank_account_id: resolve a conta padrão do tenant, exatamente como antes', async () => {
    accountRows = [{
      id: ACCOUNT_DEFAULT, company_id: COMPANY_ID, tenant_id: TENANT_ID, is_default: true, is_active: true,
      bank_code: '341', agency: '1234', account: '16102', account_digit: '5',
      billing_provider: 'itau', billing_days_to_expire: 30, itau_client_id: 'id1', itau_client_secret: 'secret1',
    }];

    const res = await app.inject({
      method: 'POST', url: `/v1/receivables/${RECEIVABLE_ID}/emit-boleto`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(202);
    const insertedValues = (mockDb.insert as any).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.bank_account_id).toBe(ACCOUNT_DEFAULT);
    expect(insertedValues.banco_code).toBe('341');
  });

  it('[fix] bank_account_id explícito é honrado no snapshot do boleto e na mensagem SQS', async () => {
    accountRows = [{
      id: ACCOUNT_OTHER, company_id: COMPANY_ID, tenant_id: TENANT_ID, is_default: false, is_active: true,
      bank_code: '001', agency: '9999', account: '55555', account_digit: '1',
      billing_provider: 'itau', billing_days_to_expire: 15, itau_client_id: 'id2', itau_client_secret: 'secret2',
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/receivables/${RECEIVABLE_ID}/emit-boleto`,
      headers: { authorization: `Bearer ${token(app)}` },
      payload: { bank_account_id: ACCOUNT_OTHER },
    });

    expect(res.statusCode).toBe(202);
    const insertedValues = (mockDb.insert as any).mock.results[0].value.values.mock.calls[0][0];
    expect(insertedValues.bank_account_id).toBe(ACCOUNT_OTHER);
    expect(insertedValues.banco_code).toBe('001');

    const sentBody = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(sentBody.banking.bank_code).toBe('001');
    expect(sentBody.days_to_expire).toBe(15);
  });

  it('retorna 400 quando o tenant não tem nenhuma conta bancária configurada', async () => {
    accountRows = [];

    const res = await app.inject({
      method: 'POST', url: `/v1/receivables/${RECEIVABLE_ID}/emit-boleto`,
      headers: { authorization: `Bearer ${token(app)}` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Dados bancários incompletos/);
  });
});
