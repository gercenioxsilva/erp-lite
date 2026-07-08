import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { billServiceOrder } from '../services/serviceOrderBillingService';
import type { DrizzleDB } from '../services/serviceOrderBillingService';

// billServiceOrder() é o coração do faturamento de OS (regra 47): gera o
// receivable a partir do total já calculado da OS e, opcionalmente, a NFS-e
// vinculada — nunca duas vezes pra mesma OS, nunca sem cliente, nunca sem os
// dados fiscais mínimos quando NFS-e é pedida.

const getSqsClientMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/sqsClient', () => ({ getSqsClient: getSqsClientMock }));

const TENANT_ID = 'tenant-1';
const SO_ID     = 'so-1';

function baseSoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SO_ID, number: '00001', title: 'Manutenção preventiva', status: 'completed',
    total: '500.00', client_id: 'client-1',
    ...overrides,
  };
}

function baseCompanyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'company-1', tenant_id: TENANT_ID, is_default: true, is_active: true,
    emite_nfe: true, emite_nfse: true,
    inscricao_municipal: '12345', codigo_servico_padrao: '101', aliquota_iss_padrao: '5.00',
    ...overrides,
  };
}

function baseClientRow(overrides: Record<string, unknown> = {}) {
  return { id: 'client-1', person_type: 'PF', full_name: 'Cliente Teste', email: null, ...overrides };
}

function makeMockDb(opts: {
  soRow?: Record<string, unknown>;
  receivableCount?: number;
  companyRows?: Record<string, unknown>[];
  clientRows?: Record<string, unknown>[];
}) {
  const insertedReceivables: Record<string, unknown>[] = [];
  const insertedNfse: Record<string, unknown>[] = [];
  const nfseUpdates: Record<string, unknown>[] = [];

  const db: any = {
    transaction: async (cb: any) => cb(db),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/FROM service_orders/i.test(text)) return { rows: opts.soRow ? [opts.soRow] : [] };
      if (/FROM receivables WHERE service_order_id/i.test(text)) return { rows: [{ count: String(opts.receivableCount ?? 0) }] };
      if (/FROM clients/i.test(text)) return { rows: opts.clientRows ?? [] };
      return { rows: [] };
    }),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve(opts.companyRows ?? []) }) })),
    insert: vi.fn((_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: async () => {
          if ('service_order_id' in data) {
            const row = { id: 'receivable-1', ...data };
            insertedReceivables.push(row);
            return [row];
          }
          const row = { id: 'nfse-1', ...data };
          insertedNfse.push(row);
          return [row];
        },
      }),
    })),
    update: vi.fn((_table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: () => { nfseUpdates.push(data); return Promise.resolve(undefined); },
      }),
    })),
  };

  return { db: db as DrizzleDB, insertedReceivables, insertedNfse, nfseUpdates };
}

describe('billServiceOrder', () => {
  const originalQueueUrl = process.env.NFE_REQUESTS_QUEUE_URL;

  beforeEach(() => { getSqsClientMock.mockReset(); });
  afterEach(() => {
    if (originalQueueUrl === undefined) delete process.env.NFE_REQUESTS_QUEUE_URL;
    else process.env.NFE_REQUESTS_QUEUE_URL = originalQueueUrl;
  });

  it('lança service_order_not_found quando a OS não existe', async () => {
    const { db } = makeMockDb({});
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID }, db))
      .rejects.toMatchObject({ code: 'service_order_not_found' });
  });

  it('bloqueia faturar uma OS que não está completed', async () => {
    const { db } = makeMockDb({ soRow: baseSoRow({ status: 'in_progress' }), receivableCount: 0 });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID }, db))
      .rejects.toMatchObject({ code: 'service_order_not_completed' });
  });

  it('bloqueia faturar uma OS já faturada (idempotência)', async () => {
    const { db } = makeMockDb({ soRow: baseSoRow(), receivableCount: 1 });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID }, db))
      .rejects.toMatchObject({ code: 'service_order_already_billed' });
  });

  it('bloqueia faturar uma OS sem cliente vinculado', async () => {
    const { db } = makeMockDb({ soRow: baseSoRow({ client_id: null }), receivableCount: 0 });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID }, db))
      .rejects.toMatchObject({ code: 'service_order_no_client' });
  });

  it('gera o receivable com o total da OS quando emitNfse=false, sem criar NFS-e', async () => {
    const { db, insertedReceivables, insertedNfse } = makeMockDb({ soRow: baseSoRow(), receivableCount: 0 });

    const result = await billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: false }, db);

    expect(insertedReceivables).toHaveLength(1);
    expect(insertedReceivables[0].amount).toBe('500');
    expect(insertedReceivables[0].service_order_id).toBe(SO_ID);
    expect(insertedReceivables[0].client_id).toBe('client-1');
    expect(insertedNfse).toHaveLength(0);
    expect(result.nfse_id).toBeNull();
    expect(result.nfse_status).toBeNull();
  });

  it('usa o vencimento informado quando fornecido', async () => {
    const { db, insertedReceivables } = makeMockDb({ soRow: baseSoRow(), receivableCount: 0 });
    await billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, dueDate: '2026-08-01' }, db);
    expect(insertedReceivables[0].due_date).toBe('2026-08-01');
  });

  it('bloqueia emissão de NFS-e quando a empresa não tem inscrição municipal', async () => {
    const { db } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [baseCompanyRow({ inscricao_municipal: null })],
    });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db))
      .rejects.toMatchObject({ code: 'service_order_billing_missing_inscricao_municipal' });
  });

  it('bloqueia emissão de NFS-e quando a empresa não tem código de serviço padrão', async () => {
    const { db } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [baseCompanyRow({ codigo_servico_padrao: null })],
    });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db))
      .rejects.toMatchObject({ code: 'service_order_billing_missing_service_code' });
  });

  it('[regra 53] bloqueia quando a empresa vinculada não emite NFS-e (só NF-e de venda)', async () => {
    const { db } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [baseCompanyRow({ emite_nfe: true, emite_nfse: false })],
    });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db))
      .rejects.toMatchObject({ code: 'service_order_billing_no_company' });
  });

  it('[regra 53] duas empresas emitem NFS-e e nenhuma é a padrão — pede seleção explícita em vez de adivinhar', async () => {
    const { db } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [
        baseCompanyRow({ id: 'company-a', is_default: false, emite_nfe: true, emite_nfse: true }),
        baseCompanyRow({ id: 'company-b', is_default: false, emite_nfe: false, emite_nfse: true }),
      ],
    });
    await expect(billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db))
      .rejects.toMatchObject({ code: 'service_order_billing_company_selection_required' });
  });

  it('gera receivable + NFS-e e enfileira emissão quando emitNfse=true e a fila está configurada', async () => {
    process.env.NFE_REQUESTS_QUEUE_URL = 'http://localhost/queue';
    const sendMock = vi.fn().mockResolvedValue({});
    getSqsClientMock.mockReturnValue({ send: sendMock });

    const { db, insertedReceivables, insertedNfse } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [baseCompanyRow()], clientRows: [baseClientRow()],
    });

    const result = await billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db);

    expect(insertedReceivables).toHaveLength(1);
    expect(insertedNfse).toHaveLength(1);
    expect(insertedNfse[0].service_code).toBe('101');
    expect(insertedNfse[0].receivable_id).toBe('receivable-1');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.nfse_id).toBe('nfse-1');
    expect(result.nfse_status).toBe('processing');
  });

  it('não bloqueia o faturamento quando a fila de NFS-e não está configurada — nfse_status fica null', async () => {
    delete process.env.NFE_REQUESTS_QUEUE_URL;
    const { db, insertedReceivables, insertedNfse } = makeMockDb({
      soRow: baseSoRow(), receivableCount: 0,
      companyRows: [baseCompanyRow()], clientRows: [baseClientRow()],
    });

    const result = await billServiceOrder({ tenantId: TENANT_ID, serviceOrderId: SO_ID, emitNfse: true }, db);

    expect(insertedReceivables).toHaveLength(1);
    expect(insertedNfse).toHaveLength(1);
    expect(result.nfse_status).toBeNull();
  });
});
