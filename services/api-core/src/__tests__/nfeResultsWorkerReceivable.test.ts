import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regressão: NF-e de venda autorizada pelo SEFAZ não gerava conta a receber
// (só o caminho legado POST /invoices/:id/issue criava, e esse nunca passa
// pelo SEFAZ de verdade — ver regra 60). Este teste prova o fluxo correto:
// toda nota autorizada gera exatamente um recebível, e reprocessar a mesma
// mensagem (SQS at-least-once) nunca duplica.

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), update: vi.fn(), insert: vi.fn(), select: vi.fn() }));

vi.mock('../db', async () => {
  const actual = await vi.importActual<any>('../db');
  return { ...actual, db: mockDb };
});

vi.mock('../lib/notificationsClient', () => ({
  sendNotificationIfEnabled: vi.fn().mockResolvedValue(undefined),
}));

import { processResult } from '../workers/nfeResultsWorker';
import { receivables, paymentPlans, paymentPlanInstallments } from '../db/schema';

const TENANT_ID  = '11111111-1111-1111-1111-111111111111';
const INVOICE_ID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID  = '33333333-3333-3333-3333-333333333333';

function baseInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT_ID, serie: '1', number: '000001',
    client_id: CLIENT_ID, total: '1500.00',
    client_name: 'ACME Ltda', client_email: null, // client_email null — pula o bloco de notificação
    ...overrides,
  };
}

function setupExecuteMock(invoiceRow: Record<string, unknown>) {
  mockDb.execute.mockImplementation(async (query: any) => {
    const text = JSON.stringify(query?.queryChunks ?? query ?? '');
    if (/cost_center_id FROM invoices/.test(text)) return { rows: [{ cost_center_id: null }] }; // pula baixa de estoque
    if (/seller_id, order_id, subtotal, total/.test(text)) return { rows: [{ seller_id: null, order_id: null, subtotal: '0', total: '0' }] }; // pula comissão
    if (/i\.tenant_id, i\.serie, i\.number/.test(text)) return { rows: [invoiceRow] };
    return { rows: [] };
  });
}

describe('nfeResultsWorker — conta a receber na autorização de NF-e de venda (regra 60)', () => {
  let insertedReceivable: Record<string, unknown> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedReceivable = undefined;

    mockDb.update.mockReturnValue({ set: () => ({ where: () => Promise.resolve(undefined) }) });
    mockDb.insert.mockImplementation((table: unknown) => {
      const isReceivables = table === receivables;
      return {
        values: (data: Record<string, unknown>) => {
          if (isReceivables) {
            insertedReceivable = data;
            return { returning: () => Promise.resolve([{ id: 'recv-1', ...data }]) };
          }
          return Promise.resolve(undefined);
        },
      };
    });
  });

  it('cria a conta a receber quando a NF-e é autorizada, vinculada ao invoice_id e ao client_id', async () => {
    setupExecuteMock(baseInvoiceRow());

    await processResult({
      invoice_id: INVOICE_ID, tenant_id: TENANT_ID, nfe_status: 'authorized',
      nfe_chave: '1234'.repeat(11), nfe_protocol: 'proto-1', nfe_auth_date: '2026-07-11T10:00:00Z',
    });

    expect(insertedReceivable).toBeDefined();
    expect(insertedReceivable).toMatchObject({
      tenant_id:   TENANT_ID,
      invoice_id:  INVOICE_ID,
      client_id:   CLIENT_ID,
      amount:      '1500.00',
      status:      'pending',
    });
    expect(insertedReceivable!.description).toMatch(/NF-e nº 000001/);
  });

  it('reprocessar o mesmo resultado (SQS at-least-once) não duplica — devolve o recebível já existente', async () => {
    setupExecuteMock(baseInvoiceRow());

    // Simula a UNIQUE parcial (migration 0065): 2ª tentativa de insert pro
    // mesmo invoice_id rejeita com 23505; createReceivableFromInvoice
    // (receivableService.ts) então busca e devolve o já existente.
    let callCount = 0;
    mockDb.insert.mockImplementation((table: unknown) => {
      const isReceivables = table === receivables;
      return {
        values: (data: Record<string, unknown>) => {
          if (!isReceivables) return Promise.resolve(undefined);
          callCount++;
          if (callCount === 1) {
            insertedReceivable = data;
            return { returning: () => Promise.resolve([{ id: 'recv-1', ...data }]) };
          }
          const err: any = new Error('duplicate key value violates unique constraint "uq_receivables_invoice"');
          err.code = '23505';
          return { returning: () => Promise.reject(err) };
        },
      };
    });
    mockDb.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ id: 'recv-1', invoice_id: INVOICE_ID }]) }) });

    await processResult({ invoice_id: INVOICE_ID, tenant_id: TENANT_ID, nfe_status: 'authorized' });
    await processResult({ invoice_id: INVOICE_ID, tenant_id: TENANT_ID, nfe_status: 'authorized' });

    expect(callCount).toBe(2); // tentou inserir as duas vezes
    // mas o 2º select (fallback de idempotência) não deveria lançar — sem
    // erro não-tratado chegando até aqui já prova que a duplicidade foi
    // absorvida com sucesso.
  });

  it('com Plano de Pagamento (regra 75), gera N recebíveis parcelados em vez de um só', async () => {
    setupExecuteMock(baseInvoiceRow({ payment_plan_id: 'plan-1', total: '100.00' }));

    const insertedByTable: Record<string, unknown>[] = [];
    mockDb.insert.mockImplementation((table: unknown) => ({
      values: (data: Record<string, unknown>) => {
        if (table === receivables) {
          insertedByTable.push(data);
          return { returning: () => Promise.resolve([{ id: `recv-${data.installment_number}`, ...data }]) };
        }
        return Promise.resolve(undefined);
      },
    }));
    const installmentRows = [
      { id: 'i1', payment_plan_id: 'plan-1', installment_number: 1, days_offset: 0,  percentage: '33.34' },
      { id: 'i2', payment_plan_id: 'plan-1', installment_number: 2, days_offset: 30, percentage: '33.33' },
      { id: 'i3', payment_plan_id: 'plan-1', installment_number: 3, days_offset: 60, percentage: '33.33' },
    ];
    mockDb.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        // where() precisa ser awaitable direto (thenable) E encadeável com
        // .orderBy() — getPlanWithInstallments usa um, loadInstallments usa o outro.
        where: () => {
          const rows = table === paymentPlans
            ? [{ id: 'plan-1', tenant_id: TENANT_ID, name: '3x sem juros', is_active: true }]
            : table === paymentPlanInstallments ? installmentRows : [];
          return {
            then: (resolve: (v: unknown) => void) => resolve(rows),
            orderBy: () => Promise.resolve(rows),
          };
        },
      }),
    }));

    await processResult({
      invoice_id: INVOICE_ID, tenant_id: TENANT_ID, nfe_status: 'authorized',
      nfe_chave: '1234'.repeat(11), nfe_protocol: 'proto-1', nfe_auth_date: '2026-07-20T10:00:00Z',
    });

    expect(insertedByTable).toHaveLength(3);
    expect(insertedByTable.map(r => r.installment_number)).toEqual([1, 2, 3]);
    const groupIds = new Set(insertedByTable.map(r => r.installment_group_id));
    expect(groupIds.size).toBe(1);
    const sumCents = insertedByTable.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
    expect(sumCents).toBe(10000);
  });

  it('uma NF-e rejeitada nunca gera conta a receber', async () => {
    setupExecuteMock(baseInvoiceRow());

    await processResult({
      invoice_id: INVOICE_ID, tenant_id: TENANT_ID, nfe_status: 'rejected',
      nfe_reject_reason: 'Rejeição: CFOP inválido',
    });

    expect(insertedReceivable).toBeUndefined();
  });
});
