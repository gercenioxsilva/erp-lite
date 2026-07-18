import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { tenantModules } from '../db';

// GET /:id/print e POST /:id/send (migration 0072) — impressão do contrato
// (independente do type, diferente do recibo que é só rental) e reenvio por
// e-mail auto-contido (sem portal público, diferente de proposta).

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID   = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = '33333333-3333-3333-3333-333333333333';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

function mockContract(overrides: Record<string, unknown> = {}) {
  mockDb.execute.mockImplementation(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query ?? '');
    if (/FROM service_contracts sc/i.test(text)) {
      return { rows: [{
        id: CONTRACT_ID, tenant_id: TENANT_ID, contract_number: '00001', type: 'service',
        description: 'Manutenção mensal', contact_name: 'Mariana', start_date: '2026-01-01', end_date: null,
        billing_frequency: 'monthly', billing_day: 5, amount: '500.00', status: 'active', notes: null,
        client_company_name: 'Cliente X Ltda', client_full_name: null, client_person_type: 'PJ',
        client_cnpj: '45427935000197', client_cpf: null, client_state_reg: null,
        client_email: 'cliente@x.com', client_phone: null, client_mobile: null,
        client_zip: null, client_street: null, client_number: null, client_complement: null,
        client_neighborhood: null, client_city: null, client_state: null,
        client_name: 'Cliente X Ltda', tenant_name: 'Minha Empresa', issuer_logo: null,
        ...overrides,
      }] };
    }
    return { rows: [] };
  });
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(
        table === tenantModules ? [{ enabled: true }] : [{
          name: 'Minha Empresa', trade_name: null, logo_url: null, tax_id: '11444777000161', tax_id_type: 'CNPJ',
          state_reg: null, street: null, street_number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null,
        }],
      ),
      // getFieldValuesForContract() faz um innerJoin — sem campos
      // personalizados cadastrados neste tenant de teste, devolve vazio.
      innerJoin: () => ({ where: () => Promise.resolve([]) }),
    }),
  }));
}

describe('GET /v1/service-contracts/:id/print', () => {
  let app: FastifyInstance;
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('404 quando o contrato não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    mockDb.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: () => Promise.resolve(table === tenantModules ? [{ enabled: true }] : []) }) }));
    const res = await app.inject({
      method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/print`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 com contrato + emissor + cliente, disponível pra qualquer type (não só rental)', async () => {
    mockContract({ type: 'service' });
    const res = await app.inject({
      method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/print`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contract.contract_number).toBe('00001');
    expect(body.client.name).toBe('Cliente X Ltda');
    expect(body.issuer.document).toBe('11444777000161');
    expect(body.custom_fields).toEqual([]);
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/print` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/service-contracts/:id/send', () => {
  let app: FastifyInstance;
  const originalQueueUrl = process.env.NOTIFICATIONS_QUEUE_URL;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.NOTIFICATIONS_QUEUE_URL = 'http://localhost/queue/notifications';
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
    if (originalQueueUrl === undefined) delete process.env.NOTIFICATIONS_QUEUE_URL;
    else process.env.NOTIFICATIONS_QUEUE_URL = originalQueueUrl;
  });

  it('404 quando o contrato não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    mockDb.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: () => Promise.resolve(table === tenantModules ? [{ enabled: true }] : []) }) }));
    const res = await app.inject({
      method: 'POST', url: `/v1/service-contracts/${CONTRACT_ID}/send`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 quando o cliente não tem e-mail cadastrado', async () => {
    mockContract({ client_email: null });
    const res = await app.inject({
      method: 'POST', url: `/v1/service-contracts/${CONTRACT_ID}/send`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/e-mail/);
  });

  it('200 e enfileira o e-mail (fire-and-forget) quando o cliente tem e-mail', async () => {
    mockContract();
    const sqsMock = (await import('../lib/sqsClient')).getSqsClient();
    const res = await app.inject({
      method: 'POST', url: `/v1/service-contracts/${CONTRACT_ID}/send`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    await new Promise(r => setTimeout(r, 0)); // fire-and-forget precisa de um tick pra rodar
    expect(sqsMock.send).toHaveBeenCalledTimes(1);
    const body = JSON.parse((sqsMock.send as any).mock.calls[0][0].input.MessageBody);
    expect(body.type).toBe('contract_sent');
    expect(body.recipient.email).toBe('cliente@x.com');
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'POST', url: `/v1/service-contracts/${CONTRACT_ID}/send` });
    expect(res.statusCode).toBe(401);
  });
});
