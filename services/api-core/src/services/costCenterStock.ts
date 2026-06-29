import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { costCenters, costCenterStock, costCenterMovements } from '../db/schema';

// ── types ─────────────────────────────────────────────────────────────────────

export type DrizzleDB = typeof _db;

export type CcMovementSource = 'manual_entry' | 'adjustment' | 'payable' | 'order' | 'invoice';

export type ApplyArgs = {
  tenantId: string;
  costCenterId: string;
  materialId: string;
  quantity: number;      // always > 0
  unitCost?: number;     // required for IN
  source: CcMovementSource;
  sourceId?: string;
  note?: string;
  userId?: string;
};

export type AdjustArgs = ApplyArgs & { targetQuantity: number };

export type CcMovement = typeof costCenterMovements.$inferSelect;

// ── DomainError ───────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'DomainError';
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isUniqueConstraintViolation(err: unknown): boolean {
  if (err instanceof Error) {
    // pg error code 23505 = unique_violation
    const pgErr = err as Error & { code?: string };
    if (pgErr.code === '23505') return true;
    // some drivers wrap the message
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('23505')) {
      return true;
    }
  }
  return false;
}

// ── applyEntry ────────────────────────────────────────────────────────────────

export async function applyEntry(args: ApplyArgs, db: DrizzleDB): Promise<CcMovement> {
  if (args.unitCost === undefined || args.unitCost === null) {
    throw new DomainError('unit_cost_required_for_entry', { materialId: args.materialId });
  }

  const idempotencyKey = `${args.source}:${args.sourceId ?? 'manual'}:${args.materialId}`;

  return db.transaction(async (tx) => {
    // 1. SELECT FOR UPDATE on existing stock row (lock if it exists)
    const lockResult = await tx.execute(
      sql`SELECT quantity, avg_unit_cost FROM cost_center_stock
          WHERE cost_center_id = ${args.costCenterId}
            AND material_id    = ${args.materialId}
          FOR UPDATE`
    );

    const existingRow = lockResult.rows[0] as { quantity: string; avg_unit_cost: string } | undefined;
    const oldQty  = existingRow ? parseFloat(existingRow.quantity)      : 0;
    const oldAvg  = existingRow ? parseFloat(existingRow.avg_unit_cost) : 0;

    // 2. Weighted average cost calculation
    const qty      = args.quantity;
    const unitCost = args.unitCost!;
    const newAvg   = oldQty === 0
      ? unitCost
      : (oldQty * oldAvg + qty * unitCost) / (oldQty + qty);
    const totalCost   = qty * unitCost;
    const balanceAfter = oldQty + qty;

    // 3. Try inserting the movement first (idempotency guard)
    let movement: CcMovement;
    try {
      const [inserted] = await tx.insert(costCenterMovements).values({
        tenant_id:       args.tenantId,
        cost_center_id:  args.costCenterId,
        material_id:     args.materialId,
        direction:       'in',
        quantity:        qty.toFixed(4),
        unit_cost:       unitCost.toFixed(2),
        total_cost:      totalCost.toFixed(2),
        balance_after:   balanceAfter.toFixed(4),
        source:          args.source,
        source_id:       args.sourceId ?? null,
        note:            args.note ?? null,
        idempotency_key: idempotencyKey,
        created_by:      args.userId ?? null,
      }).returning();
      movement = inserted;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        // Already applied — return existing movement without re-applying
        const existing = await tx
          .select()
          .from(costCenterMovements)
          .where(
            sql`tenant_id = ${args.tenantId} AND idempotency_key = ${idempotencyKey}`
          );
        return existing[0];
      }
      throw err;
    }

    // 4. Upsert stock balance
    await tx
      .insert(costCenterStock)
      .values({
        tenant_id:      args.tenantId,
        cost_center_id: args.costCenterId,
        material_id:    args.materialId,
        quantity:       balanceAfter.toFixed(4),
        avg_unit_cost:  newAvg.toFixed(4),
      })
      .onConflictDoUpdate({
        target: [costCenterStock.cost_center_id, costCenterStock.material_id],
        set: {
          quantity:      balanceAfter.toFixed(4),
          avg_unit_cost: newAvg.toFixed(4),
          updated_at:    sql`now()`,
        },
      });

    return movement;
  });
}

// ── applyExit ─────────────────────────────────────────────────────────────────

export async function applyExit(args: ApplyArgs, db: DrizzleDB): Promise<CcMovement> {
  const idempotencyKey = `${args.source}:${args.sourceId ?? 'manual'}:${args.materialId}`;

  return db.transaction(async (tx) => {
    // 1. SELECT FOR UPDATE on existing stock row
    const lockResult = await tx.execute(
      sql`SELECT quantity, avg_unit_cost FROM cost_center_stock
          WHERE cost_center_id = ${args.costCenterId}
            AND material_id    = ${args.materialId}
          FOR UPDATE`
    );

    const existingRow = lockResult.rows[0] as { quantity: string; avg_unit_cost: string } | undefined;
    const oldQty  = existingRow ? parseFloat(existingRow.quantity)      : 0;
    const oldAvg  = existingRow ? parseFloat(existingRow.avg_unit_cost) : 0;

    const qty          = args.quantity;
    const balanceAfter = oldQty - qty;

    // 2. Check allow_negative flag
    if (balanceAfter < 0) {
      const ccRows = await tx.execute(
        sql`SELECT allow_negative FROM cost_centers WHERE id = ${args.costCenterId}`
      );
      const ccRow = ccRows.rows[0] as { allow_negative: boolean } | undefined;
      const allowNegative = ccRow?.allow_negative ?? false;

      if (!allowNegative) {
        throw new DomainError('insufficient_stock', {
          available: oldQty,
          requested: qty,
        });
      }
    }

    const totalCost = qty * oldAvg;

    // 3. Try inserting the movement first (idempotency guard)
    let movement: CcMovement;
    try {
      const [inserted] = await tx.insert(costCenterMovements).values({
        tenant_id:       args.tenantId,
        cost_center_id:  args.costCenterId,
        material_id:     args.materialId,
        direction:       'out',
        quantity:        qty.toFixed(4),
        unit_cost:       oldAvg.toFixed(2),
        total_cost:      totalCost.toFixed(2),
        balance_after:   balanceAfter.toFixed(4),
        source:          args.source,
        source_id:       args.sourceId ?? null,
        note:            args.note ?? null,
        idempotency_key: idempotencyKey,
        created_by:      args.userId ?? null,
      }).returning();
      movement = inserted;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const existing = await tx
          .select()
          .from(costCenterMovements)
          .where(
            sql`tenant_id = ${args.tenantId} AND idempotency_key = ${idempotencyKey}`
          );
        return existing[0];
      }
      throw err;
    }

    // 4. Upsert stock balance (avg_unit_cost unchanged on OUT)
    await tx
      .insert(costCenterStock)
      .values({
        tenant_id:      args.tenantId,
        cost_center_id: args.costCenterId,
        material_id:    args.materialId,
        quantity:       balanceAfter.toFixed(4),
        avg_unit_cost:  oldAvg.toFixed(4),
      })
      .onConflictDoUpdate({
        target: [costCenterStock.cost_center_id, costCenterStock.material_id],
        set: {
          quantity:   balanceAfter.toFixed(4),
          updated_at: sql`now()`,
        },
      });

    return movement;
  });
}

// ── applyAdjustment ───────────────────────────────────────────────────────────

export async function applyAdjustment(args: AdjustArgs, db: DrizzleDB): Promise<CcMovement> {
  const { targetQuantity, ...baseArgs } = args;

  return db.transaction(async (tx) => {
    // Lock the stock row before reading — prevents concurrent adjustments from
    // reading the same balance and applying the same delta twice.
    const lockResult = await tx.execute(
      sql`SELECT quantity, avg_unit_cost FROM cost_center_stock
          WHERE cost_center_id = ${args.costCenterId}
            AND material_id    = ${args.materialId}
          FOR UPDATE`
    );

    const row     = lockResult.rows[0] as { quantity: string; avg_unit_cost: string } | undefined;
    const current = row ? parseFloat(row.quantity) : 0;
    const delta   = targetQuantity - current;

    if (delta === 0) {
      // No-op: return a synthetic movement record (not persisted)
      return {
        id:              'noop',
        tenant_id:       args.tenantId,
        cost_center_id:  args.costCenterId,
        material_id:     args.materialId,
        direction:       'in',
        quantity:        '0.0000',
        unit_cost:       null,
        total_cost:      null,
        balance_after:   current.toFixed(4),
        source:          'adjustment',
        source_id:       args.sourceId ?? null,
        note:            args.note ?? null,
        idempotency_key: `adjustment:${args.sourceId ?? 'manual'}:${args.materialId}`,
        created_by:      args.userId ?? null,
        created_at:      new Date(),
      } as CcMovement;
    }

    if (delta > 0) {
      return applyEntry(
        {
          ...baseArgs,
          source:   'adjustment',
          quantity: delta,
          unitCost: baseArgs.unitCost ?? (row ? parseFloat(row.avg_unit_cost) : 0),
        },
        tx as unknown as DrizzleDB
      );
    }

    // delta < 0
    return applyExit(
      {
        ...baseArgs,
        source:   'adjustment',
        quantity: Math.abs(delta),
      },
      tx as unknown as DrizzleDB
    );
  });
}
