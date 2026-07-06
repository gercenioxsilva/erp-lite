import { describe, it, expect, vi } from 'vitest';
import { confirmSupplierInvoice, cancelSupplierInvoice, SupplierInvoiceDomainError } from '../services/supplierInvoiceService';
import type { DrizzleDB } from '../services/supplierInvoiceService';

// Parcelamento de NF-e de Entrada (regra 47): confirmar uma nota com
// installments > 1 precisa gerar N payables (nunca um só), com vencimento
// mensal e valor dividido igualmente. Também cobre a proteção contra dupla
// entrada de estoque/payable pelo caminho divergence → confirmed, e o
// bloqueio de cancelamento quando alguma parcela já foi paga.

const TENANT_ID = 'tenant-1';
const SI_ID     = 'si-1';

function makeMockDb(opts: {
  siRow: Record<string, unknown> | undefined;
  itemRows?: Record<string, unknown>[];
  payablesRows?: Record<string, unknown>[];
}) {
  const insertedPayables: Record<string, unknown>[] = [];
  const cancelledPayableUpdates: string[] = [];

  const db = {
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/SELECT status, supplier_id.*FROM supplier_invoices/is.test(text) || (/FROM supplier_invoices/i.test(text) && /SELECT/i.test(text)))
        return { rows: opts.siRow ? [opts.siRow] : [] };
      if (/FROM supplier_invoice_items/i.test(text)) return { rows: opts.itemRows ?? [] };
      if (/FROM payables WHERE/i.test(text) && /SELECT/i.test(text)) return { rows: opts.payablesRows ?? [] };
      if (/UPDATE payables SET status = 'cancelled'/i.test(text)) { cancelledPayableUpdates.push(text); return { rows: [] }; }
      return { rows: [] };
    }),
    insert: vi.fn((_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: 'payable-' + (insertedPayables.length + 1), ...data };
          insertedPayables.push(row);
          return [row];
        },
      }),
    })),
  } as unknown as DrizzleDB;

  return { db, insertedPayables, cancelledPayableUpdates };
}

function baseSiRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'draft', supplier_id: 'sup-1', supplier_name: 'Fornecedor X',
    total: '300.00', due_date: '2026-07-10', purchase_order_id: null,
    installments: 1, payable_id: null, installment_group_id: null,
    ...overrides,
  };
}

describe('confirmSupplierInvoice — parcelamento', () => {
  it('[regressão] installments=1 gera exatamente 1 payable, sem campos de parcela', async () => {
    const { db, insertedPayables } = makeMockDb({ siRow: baseSiRow({ installments: 1 }), itemRows: [] });

    const result = await confirmSupplierInvoice(SI_ID, TENANT_ID, 'user-1', db);

    expect(insertedPayables).toHaveLength(1);
    expect(insertedPayables[0].amount).toBe('300');
    expect(insertedPayables[0].installment_number).toBeNull();
    expect(insertedPayables[0].installment_total).toBeNull();
    expect(insertedPayables[0].installment_group_id).toBeNull();
    expect(result.installments_generated).toBe(1);
  });

  it('installments=3 gera 3 payables com vencimento mensal, valor somando o total e mesmo installment_group_id', async () => {
    const { db, insertedPayables } = makeMockDb({ siRow: baseSiRow({ installments: 3 }), itemRows: [] });

    const result = await confirmSupplierInvoice(SI_ID, TENANT_ID, 'user-1', db);

    expect(insertedPayables).toHaveLength(3);
    const sum = insertedPayables.reduce((s, p) => s + Number(p.amount), 0);
    expect(Math.round(sum * 100) / 100).toBe(300);
    expect(insertedPayables[0].due_date).toBe('2026-07-10');
    expect(insertedPayables[1].due_date).toBe('2026-08-10');
    expect(insertedPayables[2].due_date).toBe('2026-09-10');
    const groupId = insertedPayables[0].installment_group_id;
    expect(groupId).toBeTruthy();
    expect(insertedPayables.every(p => p.installment_group_id === groupId)).toBe(true);
    expect(insertedPayables.map(p => p.installment_number)).toEqual([1, 2, 3]);
    expect(insertedPayables.every(p => p.installment_total === 3)).toBe(true);
    expect(result.installments_generated).toBe(3);
  });

  it('confirmar uma nota já em divergence não duplica payable nem estoque — só troca o status', async () => {
    const { db, insertedPayables } = makeMockDb({
      siRow: baseSiRow({ status: 'divergence', payable_id: 'payable-existing', installments: 1 }),
    });

    const result = await confirmSupplierInvoice(SI_ID, TENANT_ID, 'user-1', db);

    expect(insertedPayables).toHaveLength(0);
    expect(result.status).toBe('confirmed');
    expect(result.payable_id).toBe('payable-existing');
  });

  it('nota inexistente lança si_not_found', async () => {
    const { db } = makeMockDb({ siRow: undefined });
    await expect(confirmSupplierInvoice(SI_ID, TENANT_ID, 'user-1', db)).rejects.toBeInstanceOf(SupplierInvoiceDomainError);
  });
});

describe('cancelSupplierInvoice — cancela payable(s) vinculado(s)', () => {
  it('cancela uma nota confirmada com parcela única pendente → payable também vira cancelled', async () => {
    const { db, cancelledPayableUpdates } = makeMockDb({
      siRow: { status: 'confirmed', payable_id: 'payable-1', installment_group_id: null },
      payablesRows: [{ id: 'payable-1', status: 'pending', paid_amount: '0' }],
    });

    await cancelSupplierInvoice(SI_ID, TENANT_ID, db);

    expect(cancelledPayableUpdates).toHaveLength(1);
  });

  it('cancela uma nota parcelada (3x), todas pendentes → cancela as 3 parcelas', async () => {
    const { db, cancelledPayableUpdates } = makeMockDb({
      siRow: { status: 'confirmed', payable_id: 'payable-1', installment_group_id: 'group-1' },
      payablesRows: [
        { id: 'payable-1', status: 'pending', paid_amount: '0' },
        { id: 'payable-2', status: 'pending', paid_amount: '0' },
        { id: 'payable-3', status: 'pending', paid_amount: '0' },
      ],
    });

    await cancelSupplierInvoice(SI_ID, TENANT_ID, db);

    expect(cancelledPayableUpdates).toHaveLength(3);
  });

  it('bloqueia o cancelamento quando qualquer parcela já foi paga — nenhum payable é alterado', async () => {
    const { db, cancelledPayableUpdates } = makeMockDb({
      siRow: { status: 'confirmed', payable_id: 'payable-1', installment_group_id: 'group-1' },
      payablesRows: [
        { id: 'payable-1', status: 'paid', paid_amount: '100' },
        { id: 'payable-2', status: 'pending', paid_amount: '0' },
        { id: 'payable-3', status: 'pending', paid_amount: '0' },
      ],
    });

    await expect(cancelSupplierInvoice(SI_ID, TENANT_ID, db)).rejects.toMatchObject({ code: 'si_has_paid_installments' });
    expect(cancelledPayableUpdates).toHaveLength(0);
  });
});
