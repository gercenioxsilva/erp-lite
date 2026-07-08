// Application Service — Pedidos de Compra (P2)
// Orquestra a lógica de domínio + persistência.
// Segue o mesmo padrão de injeção de db de costCenterStock.ts / commissionService.ts.

import { sql, eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { purchaseOrders, purchaseOrderItems } from '../db/schema';
import {
  assertTransition,
  calcPOTotals,
  validatePOCreate,
  PurchaseOrderDomainError,
  type POStatus,
} from '../domain/purchaseOrder/purchaseOrderDomain';

export type DrizzleDB = typeof _db;
export { PurchaseOrderDomainError };

export type POCreate = {
  tenantId:     string;
  supplierId?:  string | null;
  supplierName?: string | null;
  expectedDate?: string | null;
  discount?:    number;
  shipping?:    number;
  notes?:       string | null;
  costCenterId?: string | null;
  createdBy?:   string | null;
  items: Array<{
    materialId?:  string | null;
    name:         string;
    sku?:         string | null;
    unit?:        string;
    quantity:     number;
    unit_price:   number;
    notes?:       string | null;
  }>;
};

export async function createPurchaseOrder(args: POCreate, db: DrizzleDB) {
  validatePOCreate({ items: args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })) });

  const { subtotal, total } = calcPOTotals(
    args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })),
    args.discount ?? 0,
    args.shipping ?? 0,
  );

  return db.transaction(async (tx) => {
    const { rows: [seq] } = await tx.execute<{ n: string }>(sql`
      SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INT END), 0) + 1 AS n
      FROM purchase_orders WHERE tenant_id = ${args.tenantId}
    `);
    const number = String(seq.n).padStart(5, '0');

    const [po] = await tx.insert(purchaseOrders).values({
      tenant_id:     args.tenantId,
      supplier_id:   args.supplierId   || null,
      supplier_name: args.supplierName || null,
      number,
      status:        'draft',
      expected_date: args.expectedDate || null,
      subtotal:      String(subtotal),
      discount:      String(args.discount ?? 0),
      shipping:      String(args.shipping ?? 0),
      total:         String(total),
      notes:         args.notes || null,
      cost_center_id: args.costCenterId || null,
      created_by:    args.createdBy || null,
    }).returning();

    for (const it of args.items) {
      await tx.insert(purchaseOrderItems).values({
        purchase_order_id: po.id,
        material_id:  it.materialId || null,
        name:         it.name,
        sku:          it.sku  || null,
        unit:         it.unit || 'UN',
        quantity:     String(it.quantity),
        unit_price:   String(it.unit_price),
        total:        String(Math.round(it.quantity * it.unit_price * 100) / 100),
        notes:        it.notes || null,
      });
    }

    return po;
  });
}

// Edição só é permitida enquanto o pedido está em 'draft' — uma vez
// aprovado, o fornecedor pode já ter recebido o pedido e uma NF-e de
// entrada pode estar vinculada a ele, então editar depois corromperia esse
// rastro. Substitui todos os itens (delete + reinsert), mesmo padrão de
// updateSupplierInvoice() em supplierInvoiceService.ts.
export async function updatePurchaseOrder(
  id:       string,
  tenantId: string,
  args:     Omit<POCreate, 'tenantId' | 'createdBy'>,
  db:       DrizzleDB,
) {
  validatePOCreate({ items: args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })) });

  const { subtotal, total } = calcPOTotals(
    args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })),
    args.discount ?? 0,
    args.shipping ?? 0,
  );

  return db.transaction(async (tx) => {
    const { rows: [existing] } = await tx.execute<{ status: string }>(
      sql`SELECT status FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    if (!existing) throw new PurchaseOrderDomainError('po_not_found', { id });
    if (existing.status !== 'draft') {
      throw new PurchaseOrderDomainError('po_not_editable', { status: existing.status });
    }

    const [po] = await tx.update(purchaseOrders).set({
      supplier_id:    args.supplierId   || null,
      supplier_name:  args.supplierName || null,
      expected_date:  args.expectedDate || null,
      subtotal:       String(subtotal),
      discount:       String(args.discount ?? 0),
      shipping:       String(args.shipping ?? 0),
      total:          String(total),
      notes:          args.notes || null,
      cost_center_id: args.costCenterId || null,
      updated_at:     new Date(),
    }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenant_id, tenantId))).returning();

    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchase_order_id, id));

    for (const it of args.items) {
      await tx.insert(purchaseOrderItems).values({
        purchase_order_id: id,
        material_id:  it.materialId || null,
        name:         it.name,
        sku:          it.sku  || null,
        unit:         it.unit || 'UN',
        quantity:     String(it.quantity),
        unit_price:   String(it.unit_price),
        total:        String(Math.round(it.quantity * it.unit_price * 100) / 100),
        notes:        it.notes || null,
      });
    }

    return po;
  });
}

export async function transitionPurchaseOrder(
  id:       string,
  tenantId: string,
  to:       POStatus,
  userId?:  string | null,
  db?: DrizzleDB,
): Promise<void> {
  const dbInst = db ?? _db;

  const { rows: [po] } = await dbInst.execute<{ status: string }>(
    sql`SELECT status FROM purchase_orders WHERE id = ${id} AND tenant_id = ${tenantId}`,
  );
  if (!po) throw new PurchaseOrderDomainError('po_not_found', { id });

  assertTransition(po.status as POStatus, to);

  const patch: Record<string, unknown> = { status: to };
  if (to === 'approved') {
    patch.approved_by = userId ?? null;
    patch.approved_at = sql`now()`;
  }

  await dbInst.execute(sql`
    UPDATE purchase_orders SET status = ${to}
    ${to === 'approved' ? sql`, approved_by = ${userId ?? null}, approved_at = now()` : sql``}
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
}
