import { sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import { inventoryMovements } from '../../db/schema';

// ── types ─────────────────────────────────────────────────────────────────────

export type DrizzleDB = typeof _db;

export type InventoryLedgerArgs = {
  tenantId: string;
  materialId: string;
  quantity: number;        // sempre > 0
  referenceId: string;
  referenceType?: string;  // default 'pos_sale'
  reason: string;
  createdBy?: string | null;
};

// ── inventory ledger ────────────────────────────────────────────────────────
//
// Baixa/estorno do estoque geral (`inventory` + `inventory_movements`),
// espelhando o padrão de orders.ts (confirmação/cancelamento de pedido).
// Deve rodar DENTRO de uma transação já aberta pelo chamador (recebe o `tx`).
// Se o material não tiver linha em `inventory`, é ignorado — mesmo comportamento
// de orders.ts (`if (!inv) continue`).

export async function applyInventoryExit(tx: DrizzleDB, args: InventoryLedgerArgs): Promise<void> {
  await moveInventory(tx, args, 'out', -1);
}

export async function applyInventoryReturn(tx: DrizzleDB, args: InventoryLedgerArgs): Promise<void> {
  await moveInventory(tx, args, 'return', 1);
}

async function moveInventory(
  tx: DrizzleDB,
  args: InventoryLedgerArgs,
  movementType: 'out' | 'return',
  sign: 1 | -1,
): Promise<void> {
  const { rows } = await tx.execute<{ id: string; quantity: string }>(
    sql`SELECT id, quantity FROM inventory
        WHERE tenant_id = ${args.tenantId} AND material_id = ${args.materialId}
        FOR UPDATE`
  );
  const inv = rows[0];
  if (!inv) return; // sem registro de estoque — não há o que movimentar

  const before = Number(inv.quantity);
  const after  = before + sign * args.quantity;

  await tx.execute(sql`UPDATE inventory SET quantity = ${String(after)} WHERE id = ${inv.id}`);

  await tx.insert(inventoryMovements).values({
    tenant_id:       args.tenantId,
    material_id:     args.materialId,
    movement_type:   movementType,
    quantity:        String(args.quantity),
    quantity_before: String(before),
    quantity_after:  String(after),
    reason:          args.reason,
    reference_id:    args.referenceId,
    reference_type:  args.referenceType ?? 'pos_sale',
    created_by:      args.createdBy ?? null,
  });
}
