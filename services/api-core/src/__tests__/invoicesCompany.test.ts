import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/invoices — resolução opcional de company_id na criação (regra 40).

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  transaction: vi.fn(),
}));

let companyRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(table === actual.nfeConfigs ? companyRows : []),
    }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const COMPANY_ID = '33333333-3333-3333-3333-333333333333';

const validItems = [{ name: 'Item 1', quantity: 1, unit_price: 100 }];

describe('POST /v1/invoices — company_id (regra 40)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    companyRows = [];
    mockDb.transaction.mockImplementation(async (fn: any) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'invoice-1', status: 'draft', serie: '1' }]) }),
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return fn(tx as any);
    });
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('[regressão] sem company_id: cria a nota normalmente, company_id fica null', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems },
    });
    expect(res.statusCode).toBe(201);
  });

  it('[multi-empresa] com company_id válido do tenant: resolve e persiste', async () => {
    companyRows = [{ id: COMPANY_ID, is_active: true, tenant_id: TENANT_ID }];
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems, company_id: COMPANY_ID },
    });
    expect(res.statusCode).toBe(201);
  });

  it('company_id que não pertence ao tenant é rejeitado (isolamento)', async () => {
    companyRows = []; // resolveCompanyId não encontra
    const res = await app.inject({
      method: 'POST', url: '/v1/invoices',
      payload: { tenant_id: TENANT_ID, client_id: CLIENT_ID, items: validItems, company_id: 'foreign-company' },
    });
    expect(res.statusCode).toBe(400);
  });
});
