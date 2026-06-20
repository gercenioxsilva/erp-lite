import { FastifyPluginAsync } from 'fastify';
import { eq, sql, and } from 'drizzle-orm';
import { db, orders, orderItems, clients, inventory, inventoryMovements } from '../db';
import { sendNotificationIfEnabled } from '../lib/notificationsClient';

interface ItemPayload {
  material_id?: string; name: string; sku?: string;
  unit?: string; quantity: number; unit_price: number; notes?: string;
}

export function calcTotals(items: ItemPayload[], discount = 0, shipping = 0) {
  const subtotal = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0);
  return { subtotal, total: subtotal - Number(discount) + Number(shipping) };
}

export const ordersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/orders ──────────────────────────────────────────────────── */
  fastify.get('/orders', async (request, reply) => {
    const { tenant_id, status, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status && status !== 'all' ? sql`AND o.status = ${status}` : sql``;
    const searchFilter = search
      ? sql`AND (o.number ILIKE ${'%' + search + '%'} OR COALESCE(c.company_name, c.full_name) ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT o.id, o.number, o.status, o.subtotal, o.discount, o.shipping, o.total,
               o.notes, o.created_at, c.id AS client_id,
               COALESCE(c.company_name, c.full_name) AS client_name
        FROM orders o JOIN clients c ON c.id = o.client_id
        WHERE o.tenant_id = ${tenant_id} ${statusFilter} ${searchFilter}
        ORDER BY o.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM orders o JOIN clients c ON c.id = o.client_id
        WHERE o.tenant_id = ${tenant_id} ${statusFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/orders ─────────────────────────────────────────────────── */
  fastify.post('/orders', async (request, reply) => {
    const { tenant_id, client_id, items, notes, discount = 0, shipping = 0, created_by } =
      request.body as any;
    if (!tenant_id || !client_id)  return reply.badRequest('tenant_id and client_id are required');
    if (!Array.isArray(items) || !items.length) return reply.badRequest('At least one item is required');

    const { subtotal, total } = calcTotals(items, discount, shipping);

    try {
      const order = await db.transaction(async (tx) => {
        const { rows: [ord] } = await tx.execute<{ id: string; number: string; status: string; total: string }>(sql`
          WITH next AS (
            SELECT COALESCE(MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INTEGER END), 0) + 1 AS n
            FROM orders WHERE tenant_id = ${tenant_id}
          )
          INSERT INTO orders (tenant_id, client_id, number, notes, subtotal, discount, shipping, total, created_by)
          SELECT ${tenant_id}, ${client_id}, LPAD(n::TEXT, 5, '0'), ${notes || null},
                 ${subtotal}, ${discount}, ${shipping}, ${total}, ${created_by || null}
          FROM next
          RETURNING id, number, status, total
        `);

        for (const it of items as ItemPayload[]) {
          await tx.insert(orderItems).values({
            order_id:    ord.id,
            material_id: it.material_id || null,
            name:        it.name,
            sku:         it.sku  || null,
            unit:        it.unit || 'UN',
            quantity:    String(it.quantity),
            unit_price:  String(it.unit_price),
            total:       String(Number(it.quantity) * Number(it.unit_price)),
            notes:       it.notes || null,
          });
        }
        return ord;
      });
      return reply.code(201).send(order);
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('Número de pedido já existe');
      throw err;
    }
  });

  /* ── GET /v1/orders/:id ─────────────────────────────────────────────── */
  fastify.get('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [{ rows: [order] }, { rows: items }] = await Promise.all([
      db.execute<any>(sql`
        SELECT o.*, COALESCE(c.company_name, c.full_name) AS client_name, c.person_type, c.cnpj, c.cpf
        FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ${id}
      `),
      db.execute<any>(sql`SELECT * FROM order_items WHERE order_id = ${id} ORDER BY created_at`),
    ]);
    if (!order) return reply.notFound('Pedido não encontrado');
    return { ...order, items };
  });

  /* ── PATCH /v1/orders/:id ───────────────────────────────────────────── */
  fastify.patch('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { client_id, notes, discount, shipping, items } = request.body as any;

    const [order] = await db.select({ id: orders.id, tenant_id: orders.tenant_id, status: orders.status })
      .from(orders).where(eq(orders.id, id));
    if (!order)              return reply.notFound('Pedido não encontrado');
    if (order.status !== 'draft') return reply.badRequest('Apenas pedidos em rascunho podem ser editados');

    await db.transaction(async (tx) => {
      const updateData: Record<string, unknown> = {};
      if (client_id !== undefined) updateData.client_id = client_id;
      if (notes     !== undefined) updateData.notes     = notes;
      if (discount  !== undefined) updateData.discount  = String(discount);
      if (shipping  !== undefined) updateData.shipping  = String(shipping);

      if (Array.isArray(items)) {
        await tx.delete(orderItems).where(eq(orderItems.order_id, id));
        const { subtotal, total } = calcTotals(items, discount ?? 0, shipping ?? 0);
        updateData.subtotal = String(subtotal);
        updateData.total    = String(total);
        for (const it of items as ItemPayload[]) {
          await tx.insert(orderItems).values({
            order_id: id, material_id: it.material_id || null, name: it.name,
            sku: it.sku || null, unit: it.unit || 'UN',
            quantity: String(it.quantity), unit_price: String(it.unit_price),
            total: String(Number(it.quantity) * Number(it.unit_price)), notes: it.notes || null,
          });
        }
      }

      if (Object.keys(updateData).length)
        await tx.update(orders).set(updateData as any).where(eq(orders.id, id));
    });

    const { rows: [updated] } = await db.execute<any>(sql`
      SELECT o.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ${id}
    `);
    return updated;
  });

  /* ── POST /v1/orders/:id/confirm ────────────────────────────────────── */
  fastify.post('/orders/:id/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [order] = await db.select({ id: orders.id, tenant_id: orders.tenant_id, status: orders.status })
      .from(orders).where(eq(orders.id, id));
    if (!order)               return reply.notFound('Pedido não encontrado');
    if (order.status !== 'draft') return reply.badRequest('Apenas rascunhos podem ser confirmados');

    const items = await db.select().from(orderItems).where(eq(orderItems.order_id, id));

    await db.transaction(async (tx) => {
      for (const it of items) {
        if (!it.material_id) continue;
        const { rows: [inv] } = await tx.execute<{ id: string; quantity: string }>(sql`
          SELECT id, quantity FROM inventory
          WHERE tenant_id = ${order.tenant_id} AND material_id = ${it.material_id}
          FOR UPDATE
        `);
        if (!inv) continue;

        const before = Number(inv.quantity);
        const after  = before - Number(it.quantity);

        await tx.update(inventory).set({ quantity: String(after) }).where(eq(inventory.id, inv.id));
        await tx.insert(inventoryMovements).values({
          tenant_id: order.tenant_id, material_id: it.material_id,
          movement_type: 'out', quantity: it.quantity,
          quantity_before: String(before), quantity_after: String(after),
          reason: 'Pedido confirmado', reference_id: id, reference_type: 'order',
        });
      }
      await tx.update(orders).set({ status: 'confirmed' }).where(eq(orders.id, id));
    });

    // Fire-and-forget notification
    db.execute<any>(sql`
      SELECT o.number, o.total, COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email
      FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE o.id = ${id}
    `).then(({ rows: [ord] }) => {
      if (!ord?.client_email) return;
      return sendNotificationIfEnabled({
        tenant_id: order.tenant_id,
        type:      'order_confirmed',
        recipient: { email: ord.client_email, name: ord.client_name ?? '' },
        data:      { order_number: ord.number, total: Number(ord.total).toFixed(2) },
      });
    }).catch(err => fastify.log.warn({ event: 'notification_enqueue_warn', error: String(err) }));

    return { ok: true, status: 'confirmed' };
  });

  /* ── POST /v1/orders/:id/deliver ────────────────────────────────────── */
  fastify.post('/orders/:id/deliver', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [order] = await db.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.id, id));
    if (!order) return reply.notFound('Pedido não encontrado');
    if (order.status !== 'confirmed' && order.status !== 'invoiced')
      return reply.badRequest('Apenas pedidos confirmados ou faturados podem ser entregues');

    await db.update(orders).set({ status: 'delivered' }).where(eq(orders.id, id));
    return { ok: true, status: 'delivered' };
  });

  /* ── POST /v1/orders/:id/cancel ─────────────────────────────────────── */
  fastify.post('/orders/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [order] = await db.select({ id: orders.id, tenant_id: orders.tenant_id, status: orders.status })
      .from(orders).where(eq(orders.id, id));
    if (!order) return reply.notFound('Pedido não encontrado');
    if (order.status === 'cancelled') return reply.badRequest('Pedido já cancelado');
    if (order.status === 'delivered') return reply.badRequest('Pedido já entregue não pode ser cancelado');

    await db.transaction(async (tx) => {
      if (order.status === 'confirmed' || order.status === 'invoiced') {
        const movements = await tx.select().from(inventoryMovements)
          .where(and(
            eq(inventoryMovements.reference_id,   id),
            eq(inventoryMovements.reference_type, 'order'),
            eq(inventoryMovements.movement_type,  'out'),
          ));

        for (const mov of movements) {
          const { rows: [inv] } = await tx.execute<{ id: string; quantity: string }>(sql`
            SELECT id, quantity FROM inventory
            WHERE tenant_id = ${order.tenant_id} AND material_id = ${mov.material_id}
            FOR UPDATE
          `);
          if (!inv) continue;
          const before = Number(inv.quantity);
          const after  = before + Number(mov.quantity);
          await tx.update(inventory).set({ quantity: String(after) }).where(eq(inventory.id, inv.id));
          await tx.insert(inventoryMovements).values({
            tenant_id: order.tenant_id, material_id: mov.material_id,
            movement_type: 'return', quantity: mov.quantity,
            quantity_before: String(before), quantity_after: String(after),
            reason: 'Pedido cancelado', reference_id: id, reference_type: 'order',
          });
        }
      }
      await tx.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, id));
    });

    return { ok: true, status: 'cancelled' };
  });
};
