import { describe, it, expect, vi } from 'vitest';
import { createReceivableFromInvoice, createReceivablesFromInvoiceWithPlan } from '../services/receivableService';
import type { DrizzleDB } from '../services/receivableService';

const TENANT_ID  = 'tenant-1';
const INVOICE_ID = 'invoice-1';
const CLIENT_ID  = 'client-1';

function makeMockDb(opts: { insertShouldConflict?: boolean; existing?: Record<string, unknown> }) {
  const db: any = {
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => ({
        returning: () => {
          if (opts.insertShouldConflict) {
            const err: any = new Error('duplicate key value violates unique constraint "uq_receivables_invoice"');
            err.code = '23505';
            return Promise.reject(err);
          }
          return Promise.resolve([{ id: 'recv-new', ...data }]);
        },
      }),
    })),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([opts.existing]) }) })),
  };
  return db as DrizzleDB;
}

describe('createReceivableFromInvoice', () => {
  it('cria e devolve a conta a receber quando não existe conflito', async () => {
    const db = makeMockDb({});
    const result = await createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'NF-e nº 000123 (série 1)', dueDate: '2026-08-10',
    }, db);

    expect(result).toMatchObject({ id: 'recv-new', tenant_id: TENANT_ID, invoice_id: INVOICE_ID, status: 'pending' });
  });

  it('idempotente: em caso de UNIQUE violation (23505), devolve o recebível já existente em vez de lançar', async () => {
    const existing = { id: 'recv-existing', tenant_id: TENANT_ID, invoice_id: INVOICE_ID, status: 'pending' };
    const db = makeMockDb({ insertShouldConflict: true, existing });

    const result = await createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'NF-e nº 000123 (série 1)', dueDate: '2026-08-10',
    }, db);

    expect(result).toEqual(existing);
  });

  it('propaga erros que não são violação de UNIQUE', async () => {
    const db: any = {
      insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.reject(new Error('connection lost')) }) })),
    };

    await expect(createReceivableFromInvoice({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: '250.00', description: 'x', dueDate: '2026-08-10',
    }, db as DrizzleDB)).rejects.toThrow('connection lost');
  });
});

// ── createReceivablesFromInvoiceWithPlan (regra 75, migration 0086) ────────────

const threeXInstallments = [
  { installment_number: 1, days_offset: 0,  percentage: 33.34 },
  { installment_number: 2, days_offset: 30, percentage: 33.33 },
  { installment_number: 3, days_offset: 60, percentage: 33.33 },
];

function makePlanMockDb(opts: { conflictInstallmentNumber?: number; existingOnConflict?: Record<string, unknown> } = {}) {
  const insertedValues: Record<string, unknown>[] = [];
  const db: any = {
    insert: vi.fn(() => ({
      values: (data: Record<string, unknown>) => {
        insertedValues.push(data);
        return {
          returning: () => {
            if (opts.conflictInstallmentNumber != null && data.installment_number === opts.conflictInstallmentNumber) {
              const err: any = new Error('duplicate key value violates unique constraint "uq_receivables_invoice_installment"');
              err.code = '23505';
              return Promise.reject(err);
            }
            return Promise.resolve([{ id: `recv-${data.installment_number}`, ...data }]);
          },
        };
      },
    })),
    select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([opts.existingOnConflict]) }) })),
  };
  return { db: db as DrizzleDB, insertedValues };
}

describe('createReceivablesFromInvoiceWithPlan', () => {
  it('gera 1 recebível por parcela, com installment_group_id compartilhado', async () => {
    const { db, insertedValues } = makePlanMockDb();
    const results = await createReceivablesFromInvoiceWithPlan({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: 100, description: 'NF-e nº 000123 (série 1)',
      baseDate: '2026-07-20', installments: threeXInstallments,
    }, db);

    expect(results).toHaveLength(3);
    expect(results.map(r => (r as any).installment_number)).toEqual([1, 2, 3]);
    const groupIds = new Set(insertedValues.map(v => v.installment_group_id));
    expect(groupIds.size).toBe(1); // mesmo group_id em todas as parcelas
    expect([...groupIds][0]).toBeTruthy(); // e não é null (>1 parcela)
    expect(insertedValues[0].description).toContain('Parcela 1/3');
  });

  it('soma das parcelas geradas bate exatamente com o total da nota', async () => {
    const { db } = makePlanMockDb();
    const results = await createReceivablesFromInvoiceWithPlan({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: 100, description: 'NF-e nº 000123 (série 1)',
      baseDate: '2026-07-20', installments: threeXInstallments,
    }, db);

    const sumCents = results.reduce((s, r) => s + Math.round(Number((r as any).amount) * 100), 0);
    expect(sumCents).toBe(10000);
  });

  it('plano de 1 parcela ("à vista" como plano) não usa installment_group_id e não sufixa "Parcela"', async () => {
    const { db, insertedValues } = makePlanMockDb();
    await createReceivablesFromInvoiceWithPlan({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: 250, description: 'NF-e nº 000123 (série 1)',
      baseDate: '2026-07-20', installments: [{ installment_number: 1, days_offset: 0, percentage: 100 }],
    }, db);

    expect(insertedValues[0].installment_group_id).toBeNull();
    expect(insertedValues[0].description).toBe('NF-e nº 000123 (série 1)');
  });

  it('idempotente por parcela: UNIQUE violation numa parcela específica devolve a já existente, sem lançar nem afetar as outras', async () => {
    const existing = { id: 'recv-existing-2', installment_number: 2, status: 'pending' };
    const { db } = makePlanMockDb({ conflictInstallmentNumber: 2, existingOnConflict: existing });

    const results = await createReceivablesFromInvoiceWithPlan({
      tenantId: TENANT_ID, invoiceId: INVOICE_ID, clientId: CLIENT_ID,
      amount: 100, description: 'NF-e nº 000123 (série 1)',
      baseDate: '2026-07-20', installments: threeXInstallments,
    }, db);

    expect(results).toHaveLength(3);
    expect(results[1]).toEqual(existing); // parcela 2 veio do SELECT, não do INSERT
    expect((results[0] as any).id).toBe('recv-1');
    expect((results[2] as any).id).toBe('recv-3');
  });
});
