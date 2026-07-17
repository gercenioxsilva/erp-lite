import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

// POST /v1/service-contracts e POST /:id/billings — resolução de company_id
// (regra 40): o contrato herda a empresa emissora, o faturamento resolve por
// ela ao invés de assumir uma única config fiscal por tenant.

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

let companyRows: unknown[] = [];

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  mockDb.select.mockImplementation(() => ({
    from: () => ({ where: vi.fn().mockResolvedValue([{ id: 'client-1' }]) }),
  }));
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID  = '22222222-2222-2222-2222-222222222222';
const COMPANY_ID = '33333333-3333-3333-3333-333333333333';

describe('POST /v1/service-contracts — company_id (regra 40)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.select.mockImplementation(() => ({
      from: () => ({ where: vi.fn().mockResolvedValue([{ id: CLIENT_ID }]) }),
    }));
    mockDb.execute.mockResolvedValue({ rows: [{ count: 0 }] });
    app = await buildApp();
    // Sign a fake JWT so authenticate passes — tenantId matches TENANT_ID used
    // throughout this file's mocked data/assertions.
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => { await app.close(); });

  it('aceita company_id opcional e persiste no contrato criado', async () => {
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'contract-1', company_id: COMPANY_ID }]),
      }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/service-contracts',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        tenant_id: TENANT_ID, client_id: CLIENT_ID, company_id: COMPANY_ID,
        description: 'Manutenção mensal', start_date: '2026-01-01',
        billing_frequency: 'monthly', billing_day: 5, amount: 200,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().company_id).toBe(COMPANY_ID);
  });
});

describe('POST /v1/service-contracts/:id/billings — resolução de empresa na emissão de NFS-e', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    companyRows = [];
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue/nfe-requests';

    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/service_contracts sc/i.test(text)) {
        return {
          rows: [{
            id: 'contract-1', tenant_id: TENANT_ID, client_id: CLIENT_ID,
            company_id: COMPANY_ID, status: 'active', nfse_enabled: true,
            description: 'Manutenção', amount: '200.00', client_name: 'Cliente X',
            codigo_servico: '14.01', aliquota_iss: null,
          }],
        };
      }
      if (/contract_billings/i.test(text)) return { rows: [{ count: 0 }] };
      if (/FROM clients/i.test(text))       return { rows: [{ id: CLIENT_ID, email: 'a@b.com' }] };
      return { rows: [] };
    });

    mockDb.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: async () => {
          const actual = await import('../db');
          return table === (actual as any).nfeConfigs ? companyRows : [];
        },
      }),
    }));

    app = await buildApp();
    // Sign a fake JWT so authenticate passes — tenantId matches TENANT_ID used
    // throughout this file's mocked data/assertions.
    token = app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
  });

  afterEach(async () => {
    await app.close();
    delete process.env.NFE_REQUESTS_QUEUE_URL;
  });

  it('[multi-empresa] resolve via contract.company_id — bloqueia com mensagem clara quando a empresa não tem Inscrição Municipal', async () => {
    companyRows = [{ id: COMPANY_ID, is_active: true, emite_nfse: true, inscricao_municipal: null, codigo_servico_padrao: null, aliquota_iss_padrao: '0' }];

    const res = await app.inject({
      method: 'POST', url: '/v1/service-contracts/contract-1/billings',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Inscrição Municipal/);
  });

  it('[regressão — "permissao_negada: CNPJ do emitente não autorizado"] bloqueia em produção sem token de produção configurado, antes de enfileirar', async () => {
    companyRows = [{
      id: COMPANY_ID, is_active: true, emite_nfse: true, inscricao_municipal: '12345',
      codigo_servico_padrao: '14.01', aliquota_iss_padrao: '5.00',
      focus_ambiente: 1, focus_token_producao: null,
    }];

    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: '/v1/service-contracts/contract-1/billings',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/token de Produção/);
    expect(sqsMock.send).not.toHaveBeenCalled();
  });

  it('company_id do contrato não resolve para nenhuma empresa do tenant → mensagem de configuração fiscal', async () => {
    companyRows = [];

    const res = await app.inject({
      method: 'POST', url: '/v1/service-contracts/contract-1/billings',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Configure os dados fiscais/);
  });
});
