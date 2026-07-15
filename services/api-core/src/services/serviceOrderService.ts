// Application Service — Ordens de Serviço.
// Orquestra a lógica de domínio + persistência. Mesmo padrão de
// purchaseOrderService.ts.

import { and, eq, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { serviceOrders, serviceOrderItems } from '../db/schema';
import {
  assertServiceOrderTransition,
  assertServiceOrderEditable,
  calcServiceOrderTotals,
  validateServiceOrderCreate,
  ServiceOrderDomainError,
  type ServiceOrderStatus,
  type ServiceOrderType,
} from '../domain/serviceOrder/serviceOrderDomain';

export type DrizzleDB = typeof _db;
export { ServiceOrderDomainError };

export type ServiceOrderCreate = {
  tenantId:      string;
  clientId?:     string | null;
  costCenterId?: string | null;
  title:         string;
  description?:  string | null;
  type:          ServiceOrderType;
  createdBy?:    string | null;
  items?: Array<{
    materialId?:  string | null;
    description:  string;
    quantity:     number;
    unit_price:   number;
  }>;
};

export async function createServiceOrder(args: ServiceOrderCreate, db: DrizzleDB = _db) {
  const items = args.items ?? [];
  validateServiceOrderCreate({ title: args.title, type: args.type, items });

  const { subtotal, total } = calcServiceOrderTotals(items);

  return db.transaction(async (tx) => {
    const { rows: [seq] } = await tx.execute<{ n: string }>(sql`
      SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INT END), 0) + 1 AS n
      FROM service_orders WHERE tenant_id = ${args.tenantId}
    `);
    const number = String(seq.n).padStart(5, '0');

    const [so] = await tx.insert(serviceOrders).values({
      tenant_id:      args.tenantId,
      client_id:      args.clientId      || null,
      cost_center_id: args.costCenterId  || null,
      number,
      title:          args.title.trim(),
      description:    args.description   || null,
      type:           args.type,
      status:         'draft',
      subtotal:       String(subtotal),
      total:          String(total),
      created_by:     args.createdBy || null,
    }).returning();

    for (const it of items) {
      await tx.insert(serviceOrderItems).values({
        service_order_id: so.id,
        material_id:  it.materialId || null,
        description:  it.description.trim(),
        quantity:     String(it.quantity),
        unit_price:   String(it.unit_price),
        total:        String(Math.round(it.quantity * it.unit_price * 100) / 100),
      });
    }

    return so;
  });
}

export type ServiceOrderUpdate = Omit<ServiceOrderCreate, 'tenantId' | 'createdBy'>;

// Substitui header + itens por completo (delete + reinsert), só permitido
// em 'draft' — mesmo padrão de updatePurchaseOrder()/updateSupplierInvoice().
export async function updateServiceOrder(
  id: string, tenantId: string, args: ServiceOrderUpdate, db: DrizzleDB = _db,
) {
  const items = args.items ?? [];
  validateServiceOrderCreate({ title: args.title, type: args.type, items });

  const { subtotal, total } = calcServiceOrderTotals(items);

  return db.transaction(async (tx) => {
    const { rows: [existing] } = await tx.execute<{ status: string }>(
      sql`SELECT status FROM service_orders WHERE id = ${id} AND tenant_id = ${tenantId}`,
    );
    if (!existing) throw new ServiceOrderDomainError('service_order_not_found', { id });
    assertServiceOrderEditable(existing.status as ServiceOrderStatus);

    const [so] = await tx.update(serviceOrders).set({
      client_id:      args.clientId      || null,
      cost_center_id: args.costCenterId  || null,
      title:          args.title.trim(),
      description:    args.description   || null,
      type:           args.type,
      subtotal:       String(subtotal),
      total:          String(total),
      updated_at:     new Date(),
    }).where(and(eq(serviceOrders.id, id), eq(serviceOrders.tenant_id, tenantId))).returning();

    await tx.delete(serviceOrderItems).where(eq(serviceOrderItems.service_order_id, id));

    for (const it of items) {
      await tx.insert(serviceOrderItems).values({
        service_order_id: id,
        material_id:  it.materialId || null,
        description:  it.description.trim(),
        quantity:     String(it.quantity),
        unit_price:   String(it.unit_price),
        total:        String(Math.round(it.quantity * it.unit_price * 100) / 100),
      });
    }

    return so;
  });
}

export async function transitionServiceOrder(
  id: string, tenantId: string, to: ServiceOrderStatus, db: DrizzleDB = _db,
): Promise<void> {
  const { rows: [so] } = await db.execute<{ status: string }>(
    sql`SELECT status FROM service_orders WHERE id = ${id} AND tenant_id = ${tenantId}`,
  );
  if (!so) throw new ServiceOrderDomainError('service_order_not_found', { id });

  assertServiceOrderTransition(so.status as ServiceOrderStatus, to);

  await db.execute(sql`
    UPDATE service_orders SET status = ${to} WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
}
