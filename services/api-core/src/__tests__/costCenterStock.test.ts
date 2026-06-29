import { describe, it, expect } from 'vitest';
import { applyEntry, applyExit, applyAdjustment, DomainError } from '../services/costCenterStock';
import type { DrizzleDB, ApplyArgs } from '../services/costCenterStock';

// ── helpers to build mock DB ──────────────────────────────────────────────────

type StockRow = { quantity: string; avg_unit_cost: string };
type CcRow    = { allow_negative: boolean };

/**
 * Build a minimal in-memory DB mock.
 *
 * The service issues execute() calls in a predictable order inside a transaction:
 *   applyEntry: call 1 = SELECT FOR UPDATE (stock)
 *   applyExit:  call 1 = SELECT FOR UPDATE (stock), call 2 = SELECT cost_centers
 *
 * We use a per-transaction call counter to return the right rows.
 */
function makeMockDb(opts: {
  stockRow?:         StockRow | null;
  ccRow?:            CcRow | null;
  insertThrow?:      Error;
  existingMovement?: Record<string, unknown> | null;
  // outer execute for applyAdjustment's initial stock read
  outerStockRow?: StockRow | null;
}): { db: DrizzleDB; insertedMovements: Record<string, unknown>[]; upsertedStock: Record<string, unknown>[] } {

  const insertedMovements: Record<string, unknown>[] = [];
  const upsertedStock:     Record<string, unknown>[] = [];
  let   movementInsertCallCount = 0;

  // ── insert chain ──────────────────────────────────────────────────────────
  function makeInsertChain(_table: unknown): unknown {
    return {
      values: (data: Record<string, unknown>) => {
        const isMovement = 'idempotency_key' in data;

        if (isMovement) {
          movementInsertCallCount++;
          const callNum = movementInsertCallCount;
          return {
            returning: async () => {
              if (opts.insertThrow && callNum === 1) {
                throw opts.insertThrow;
              }
              const movement = {
                id:         'mov-' + Math.random().toString(36).slice(2),
                ...data,
                created_at: new Date(),
              };
              insertedMovements.push(movement);
              return [movement];
            },
          };
        }

        // stock upsert
        return {
          onConflictDoUpdate: (_conf: unknown) => {
            upsertedStock.push(data);
            return Promise.resolve([]);
          },
        };
      },
    };
  }

  // ── select chain (used in idempotency lookup) ─────────────────────────────
  function makeSelectChain(): unknown {
    return {
      from: (_table: unknown) => ({
        where: (_cond: unknown) => {
          const mv = opts.existingMovement ?? null;
          return Promise.resolve(mv ? [mv] : []);
        },
      }),
    };
  }

  // ── execute ───────────────────────────────────────────────────────────────
  // We track how many execute calls have happened *within the current transaction*
  // to know which query we're answering.
  function makeTxExecute(): (q: unknown) => Promise<{ rows: unknown[] }> {
    let callCount = 0;
    return (_q: unknown) => {
      callCount++;
      if (callCount === 1) {
        // Always first: SELECT FOR UPDATE on cost_center_stock
        return Promise.resolve({ rows: opts.stockRow ? [opts.stockRow] : [] });
      }
      // Second call (applyExit only): SELECT cost_centers for allow_negative
      return Promise.resolve({ rows: opts.ccRow ? [opts.ccRow] : [{ allow_negative: false }] });
    };
  }

  // Outer execute (applyAdjustment initial stock read, outside transaction)
  function outerExecute(_q: unknown): Promise<{ rows: unknown[] }> {
    const row = opts.outerStockRow ?? opts.stockRow;
    return Promise.resolve({ rows: row ? [row] : [] });
  }

  // ── db ────────────────────────────────────────────────────────────────────
  const db = {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const txExecute = makeTxExecute();
      // tx needs its own .transaction() so that nested calls from applyEntry/
      // applyExit (invoked via applyAdjustment passing tx as db) stay within
      // the same logical transaction. The nested call resets the execute counter
      // so that applyEntry/applyExit see call 1 = stock lock, call 2 = cost_centers.
      const makeTx = (): Record<string, unknown> => {
        const tx: Record<string, unknown> = {
          execute: txExecute,
          insert:  makeInsertChain,
          select:  makeSelectChain,
        };
        tx.transaction = async (nestedCb: (inner: unknown) => Promise<unknown>) => {
          // Nested savepoint: fresh execute counter so the inner function's
          // call 1 = stock FOR UPDATE, call 2 = cost_centers (same contract).
          const innerTx: Record<string, unknown> = {
            execute: makeTxExecute(),
            insert:  makeInsertChain,
            select:  makeSelectChain,
          };
          innerTx.transaction = tx.transaction;
          return nestedCb(innerTx);
        };
        return tx;
      };
      return cb(makeTx());
    },
    execute: outerExecute,
    select:  makeSelectChain,
    insert:  makeInsertChain,
  } as unknown as DrizzleDB;

  return { db, insertedMovements, upsertedStock };
}

// ── base args ─────────────────────────────────────────────────────────────────

const BASE: ApplyArgs = {
  tenantId:     'tenant-1',
  costCenterId: 'cc-1',
  materialId:   'mat-1',
  quantity:     5,
  unitCost:     10,
  source:       'manual_entry',
  sourceId:     'src-1',
};

// ── applyEntry ────────────────────────────────────────────────────────────────

describe('applyEntry', () => {
  it('first IN: balance = qty, avg = unitCost', async () => {
    const { db, insertedMovements, upsertedStock } = makeMockDb({ stockRow: null });

    const mov = await applyEntry(BASE, db);

    expect(mov.direction).toBe('in');
    expect(parseFloat(mov.balance_after as string)).toBe(5);
    expect(parseFloat(mov.total_cost   as string)).toBe(50);  // 5 * 10

    expect(insertedMovements).toHaveLength(1);
    expect(parseFloat(insertedMovements[0].balance_after as string)).toBe(5);

    expect(upsertedStock).toHaveLength(1);
    expect(parseFloat(upsertedStock[0].quantity      as string)).toBe(5);
    expect(parseFloat(upsertedStock[0].avg_unit_cost as string)).toBe(10);
  });

  it('second IN: correctly blends weighted average (5@10 + 5@20 = avg 15)', async () => {
    const { db, upsertedStock } = makeMockDb({
      stockRow: { quantity: '5', avg_unit_cost: '10' },
    });

    await applyEntry({ ...BASE, quantity: 5, unitCost: 20 }, db);

    expect(upsertedStock).toHaveLength(1);
    expect(parseFloat(upsertedStock[0].quantity      as string)).toBe(10);
    expect(parseFloat(upsertedStock[0].avg_unit_cost as string)).toBe(15);
  });

  it('throws DomainError when unitCost is omitted', async () => {
    const { db } = makeMockDb({ stockRow: null });
    const args: Partial<ApplyArgs> = { ...BASE };
    delete args.unitCost;

    await expect(applyEntry(args as ApplyArgs, db)).rejects.toMatchObject({
      code: 'unit_cost_required_for_entry',
    });
  });
});

// ── applyExit ─────────────────────────────────────────────────────────────────

describe('applyExit', () => {
  it('OUT decrements balance; avg unchanged; total_cost = qty * avg', async () => {
    const { db, insertedMovements, upsertedStock } = makeMockDb({
      stockRow: { quantity: '10', avg_unit_cost: '15' },
      ccRow:    { allow_negative: false },
    });

    const mov = await applyExit({ ...BASE, quantity: 4, unitCost: undefined }, db);

    expect(mov.direction).toBe('out');
    expect(parseFloat(mov.balance_after as string)).toBe(6);
    expect(parseFloat(mov.total_cost   as string)).toBeCloseTo(60);  // 4 * 15

    expect(insertedMovements).toHaveLength(1);

    expect(upsertedStock).toHaveLength(1);
    expect(parseFloat(upsertedStock[0].quantity      as string)).toBe(6);
    expect(parseFloat(upsertedStock[0].avg_unit_cost as string)).toBe(15);
  });

  it('insufficient stock with allow_negative=false → throws DomainError', async () => {
    const { db } = makeMockDb({
      stockRow: { quantity: '3', avg_unit_cost: '10' },
      ccRow:    { allow_negative: false },
    });

    await expect(
      applyExit({ ...BASE, quantity: 5, unitCost: undefined }, db)
    ).rejects.toSatisfy((e: unknown) => {
      return e instanceof DomainError
        && e.code    === 'insufficient_stock'
        && (e.payload as Record<string, unknown>).available === 3
        && (e.payload as Record<string, unknown>).requested === 5;
    });
  });

  it('insufficient stock with allow_negative=true → succeeds, balance goes negative', async () => {
    const { db, upsertedStock } = makeMockDb({
      stockRow: { quantity: '3', avg_unit_cost: '10' },
      ccRow:    { allow_negative: true },
    });

    const mov = await applyExit({ ...BASE, quantity: 5, unitCost: undefined }, db);

    expect(parseFloat(mov.balance_after as string)).toBe(-2);
    expect(upsertedStock).toHaveLength(1);
    expect(parseFloat(upsertedStock[0].quantity as string)).toBe(-2);
  });
});

// ── idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('second applyEntry with same key returns existing movement without re-applying', async () => {
    const existingMovement = {
      id:              'existing-mov-1',
      tenant_id:       'tenant-1',
      cost_center_id:  'cc-1',
      material_id:     'mat-1',
      direction:       'in',
      quantity:        '5.0000',
      unit_cost:       '10.00',
      total_cost:      '50.00',
      balance_after:   '5.0000',
      source:          'manual_entry',
      source_id:       'src-1',
      note:            null,
      idempotency_key: 'manual_entry:src-1:mat-1',
      created_by:      null,
      created_at:      new Date(),
    };

    const uniqueErr: Error & { code?: string } = new Error('unique violation');
    uniqueErr.code = '23505';

    const { db, insertedMovements, upsertedStock } = makeMockDb({
      stockRow:         { quantity: '5', avg_unit_cost: '10' },
      insertThrow:      uniqueErr,
      existingMovement: existingMovement,
    });

    const mov = await applyEntry(BASE, db);

    expect(mov.id).toBe('existing-mov-1');
    expect(upsertedStock).toHaveLength(0);      // no stock update
    expect(insertedMovements).toHaveLength(0);  // no new movement
  });
});

// ── applyAdjustment ───────────────────────────────────────────────────────────

describe('applyAdjustment', () => {
  it('delta > 0 → calls applyEntry path, increases balance', async () => {
    const { db, upsertedStock } = makeMockDb({
      stockRow: { quantity: '5', avg_unit_cost: '10' },
    });

    const mov = await applyAdjustment(
      { ...BASE, source: 'adjustment', targetQuantity: 8, unitCost: 10 },
      db
    );

    if ('skipped' in mov) throw new Error('Expected a movement, got skipped');
    expect(mov.direction).toBe('in');
    expect(parseFloat(mov.balance_after as string)).toBe(8);
    expect(upsertedStock[0]).toBeDefined();
    expect(parseFloat(upsertedStock[0].quantity as string)).toBe(8);
  });

  it('delta < 0 → calls applyExit path, decreases balance', async () => {
    const { db, upsertedStock } = makeMockDb({
      stockRow: { quantity: '10', avg_unit_cost: '15' },
      ccRow:    { allow_negative: false },
    });

    const mov = await applyAdjustment(
      { ...BASE, source: 'adjustment', targetQuantity: 4 },
      db
    );

    if ('skipped' in mov) throw new Error('Expected a movement, got skipped');
    expect(mov.direction).toBe('out');
    expect(parseFloat(mov.balance_after as string)).toBe(4);
    expect(upsertedStock[0]).toBeDefined();
    expect(parseFloat(upsertedStock[0].quantity as string)).toBe(4);
  });

  it('delta = 0 → returns skipped, nothing written', async () => {
    const { db, insertedMovements, upsertedStock } = makeMockDb({
      stockRow: { quantity: '5', avg_unit_cost: '10' },
    });

    const mov = await applyAdjustment(
      { ...BASE, source: 'adjustment', targetQuantity: 5 },
      db
    );

    expect('skipped' in mov && mov.skipped).toBe(true);
    expect(insertedMovements).toHaveLength(0);
    expect(upsertedStock).toHaveLength(0);
  });
});
