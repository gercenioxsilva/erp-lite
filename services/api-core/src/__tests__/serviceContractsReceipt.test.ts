import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { receivables, contractBillings } from '../db';

// Nota de Locação / Recibo / Fatura (regra 69) — numeração sequencial gerada
// em toda cobrança (POST /:id/billings) e a rota de leitura pro documento
// (GET /:id/billings/:billingId/receipt), disponível só pra contratos
// type='rental', tolerante à ausência de conta bancária cadastrada.

vi.mock('../lib/sqsClient', () => ({
  getSqsClient: vi.fn().mockReturnValue({ send: vi.fn().mockResolvedValue({}) }),
}));

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(), select: vi.fn(), insert: vi.fn(),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
}));

vi.mock('../db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../db');
  return { ...actual, db: mockDb };
});

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID  = '22222222-2222-2222-2222-222222222222';
const CONTRACT_ID = '33333333-3333-3333-3333-333333333333';
const BILLING_ID  = '44444444-4444-4444-4444-444444444444';

function authToken(app: FastifyInstance) {
  return app.jwt.sign({ tenantId: TENANT_ID, userId: 'user-1', role: 'admin' });
}

describe('POST /v1/service-contracts/:id/billings — document_number', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (cb: any) => cb(mockDb));
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  it('gera document_number sequencial (4 dígitos) pra toda cobrança, mesmo sem NFS-e', async () => {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/service_contracts sc/i.test(text)) {
        return { rows: [{
          id: CONTRACT_ID, tenant_id: TENANT_ID, client_id: CLIENT_ID, status: 'active',
          nfse_enabled: false, description: 'Locação de compressores', amount: '3950.00',
          client_name: 'Cliente X', type: 'rental',
        }] };
      }
      if (/document_number/i.test(text)) return { rows: [{ n: '5' }] };
      if (/contract_billings/i.test(text)) return { rows: [{ count: 0 }] }; // checagem de período duplicado
      return { rows: [] };
    });

    const insertedBilling: any[] = [];
    mockDb.insert.mockImplementation((table: unknown) => {
      if (table === receivables) {
        return { values: () => ({ returning: () => Promise.resolve([{ id: 'rec-1' }]) }) };
      }
      if (table === contractBillings) {
        return {
          values: (v: any) => {
            insertedBilling.push(v);
            return { returning: () => Promise.resolve([{ id: BILLING_ID, ...v }]) };
          },
        };
      }
      throw new Error('unexpected insert table');
    });

    const res = await app.inject({
      method: 'POST', url: `/v1/service-contracts/${CONTRACT_ID}/billings`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });

    expect(res.statusCode).toBe(201);
    expect(insertedBilling[0].document_number).toBe('0005');
  });
});

describe('GET /v1/service-contracts/:id/billings/:billingId/receipt', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => { await app.close(); });

  function mockContract(type: string) {
    mockDb.execute.mockImplementation(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_contracts sc/i.test(text)) {
        return { rows: [{
          id: CONTRACT_ID, tenant_id: TENANT_ID, type,
          description: 'Locação de compressores', billing_day: 25, contact_name: 'Mariana',
          client_company_name: 'Alamo Via Brasil Soluções Ltda', client_full_name: null,
          client_person_type: 'PJ', client_cnpj: '45427935000197', client_cpf: null,
          client_state_reg: '672571871110', client_email: 'contato@alamo.com', client_phone: null, client_mobile: null,
          client_zip: '08674011', client_street: 'Rua Benjamin Constan', client_number: '697',
          client_complement: 'Sala 08', client_neighborhood: 'Centro', client_city: 'Suzano', client_state: 'SP',
        }] };
      }
      if (/FROM contract_billings/i.test(text)) {
        return { rows: [{
          id: BILLING_ID, document_number: '0448', created_at: '2025-07-17T10:00:00Z',
          due_date: '2025-08-25', period_start: '2025-07-17', period_end: '2025-08-16', amount: '3950.00',
        }] };
      }
      return { rows: [] };
    });
    // Sem empresa padrão cadastrada (nfeConfigs vazio) → resolveBankAccount
    // lança BankAccountDomainError → seção de pagamento vem null, nunca
    // bloqueia a emissão do documento.
    mockDb.select.mockImplementation(() => ({ from: () => ({ where: () => Promise.resolve([]) }) }));
  }

  it('400 quando o contrato não é do tipo locação', async () => {
    mockContract('service');
    const res = await app.inject({
      method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/billings/${BILLING_ID}/receipt`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/locação/);
  });

  it('404 quando o contrato não existe', async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });
    mockDb.select.mockImplementation(() => ({ from: () => ({ where: () => Promise.resolve([]) }) }));
    const res = await app.inject({
      method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/billings/${BILLING_ID}/receipt`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 com todos os dados quando type=rental — tolerante à ausência de conta bancária', async () => {
    mockContract('rental');
    const res = await app.inject({
      method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/billings/${BILLING_ID}/receipt`,
      headers: { authorization: `Bearer ${authToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.billing.document_number).toBe('0448');
    expect(body.contract.contact_name).toBe('Mariana');
    expect(body.client.name).toBe('Alamo Via Brasil Soluções Ltda');
    expect(body.bank_account).toBeNull();
  });

  it('401 sem token de autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/service-contracts/${CONTRACT_ID}/billings/${BILLING_ID}/receipt` });
    expect(res.statusCode).toBe(401);
  });
});
