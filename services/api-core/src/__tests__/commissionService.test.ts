import { describe, it, expect } from 'vitest';
import { accrueCommission, cancelCommission } from '../services/commissionService';
import type { DrizzleDB, AccrueArgs } from '../services/commissionService';

// ── helpers to build mock DB ──────────────────────────────────────────────────

function makeMockDb(opts: {
  insertThrow?:      Error;
  existingEntry?:    Record<string, unknown> | null;
  updateReturning?:  Record<string, unknown>[];
}): {
  db: DrizzleDB;
  insertedEntries: Record<string, unknown>[];
  updateCalls: { set: Record<string, unknown>; where: unknown }[];
} {
  const insertedEntries: Record<string, unknown>[] = [];
  const updateCalls: { set: Record<string, unknown>; where: unknown }[] = [];

  const db = {
    insert: (_table: unknown) => ({
      values: (data: Record<string, unknown>) => ({
        returning: async () => {
          if (opts.insertThrow) throw opts.insertThrow;
          const entry = { id: 'comm-' + Math.random().toString(36).slice(2), ...data, created_at: new Date() };
          insertedEntries.push(entry);
          return [entry];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (_cond: unknown) => {
          const e = opts.existingEntry ?? null;
          return Promise.resolve(e ? [e] : []);
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (setData: Record<string, unknown>) => ({
        where: (whereCond: unknown) => ({
          returning: async () => {
            updateCalls.push({ set: setData, where: whereCond });
            return opts.updateReturning ?? [];
          },
        }),
      }),
    }),
  } as unknown as DrizzleDB;

  return { db, insertedEntries, updateCalls };
}

// ── base args ─────────────────────────────────────────────────────────────────

const BASE: AccrueArgs = {
  tenantId:   'tenant-1',
  sellerId:   'seller-1',
  invoiceId:  'invoice-1',
  orderId:    'order-1',
  baseAmount: 1000,
  rate:       5,
};

// ── accrueCommission ─────────────────────────────────────────────────────────

describe('accrueCommission', () => {
  it('computes commission_amount = baseAmount * rate / 100', async () => {
    const { db, insertedEntries } = makeMockDb({});

    const entry = await accrueCommission(BASE, db);

    expect(insertedEntries).toHaveLength(1);
    expect(entry.commission_amount).toBe('50.00'); // 1000 * 5% = 50
    expect(entry.base_amount).toBe('1000.00');
    expect(entry.rate).toBe('5.00');
    expect(entry.status).toBe('accrued');
    expect(entry.idempotency_key).toBe('invoice:invoice-1');
  });

  it('rounds commission_amount to 2 decimals', async () => {
    const { db, insertedEntries } = makeMockDb({});

    await accrueCommission({ ...BASE, baseAmount: 333.33, rate: 7.5 }, db);

    // 333.33 * 7.5 / 100 = 24.99975 → rounds to 25.00
    expect(insertedEntries[0].commission_amount).toBe('25.00');
  });

  it('stores order_id when provided, null when omitted', async () => {
    const { db, insertedEntries } = makeMockDb({});

    await accrueCommission({ ...BASE, orderId: null }, db);

    expect(insertedEntries[0].order_id).toBeNull();
  });

  it('idempotent: unique violation on retry returns existing entry without re-inserting', async () => {
    const existingEntry = {
      id:                'existing-comm-1',
      tenant_id:          'tenant-1',
      seller_id:          'seller-1',
      invoice_id:         'invoice-1',
      order_id:           'order-1',
      base_amount:        '1000.00',
      rate:               '5.00',
      commission_amount:  '50.00',
      status:             'accrued',
      idempotency_key:    'invoice:invoice-1',
      cancelled_at:       null,
      created_at:         new Date(),
    };

    const uniqueErr: Error & { code?: string } = new Error('unique violation');
    uniqueErr.code = '23505';

    const { db, insertedEntries } = makeMockDb({ insertThrow: uniqueErr, existingEntry });

    const entry = await accrueCommission(BASE, db);

    expect(entry.id).toBe('existing-comm-1');
    expect(insertedEntries).toHaveLength(0);
  });

  it('non-unique-constraint errors propagate', async () => {
    const { db } = makeMockDb({ insertThrow: new Error('connection lost') });

    await expect(accrueCommission(BASE, db)).rejects.toThrow('connection lost');
  });
});

// ── cancelCommission ─────────────────────────────────────────────────────────

describe('cancelCommission', () => {
  it('updates status to cancelled and returns the entry', async () => {
    const cancelled = {
      id: 'comm-1', invoice_id: 'invoice-1', status: 'cancelled', cancelled_at: new Date(),
    };
    const { db, updateCalls } = makeMockDb({ updateReturning: [cancelled] });

    const result = await cancelCommission({ tenantId: 'tenant-1', invoiceId: 'invoice-1' }, db);

    expect(result).toEqual(cancelled);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].set.status).toBe('cancelled');
  });

  it('returns null when no accrued commission exists for the invoice (idempotent)', async () => {
    const { db } = makeMockDb({ updateReturning: [] });

    const result = await cancelCommission({ tenantId: 'tenant-1', invoiceId: 'invoice-without-commission' }, db);

    expect(result).toBeNull();
  });
});
