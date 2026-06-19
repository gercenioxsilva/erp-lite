import { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';
import { sendNotificationIfEnabled } from '../lib/notificationsClient';

interface ItemPayload {
  material_id?: string;
  name:         string;
  sku?:         string;
  unit?:        string;
  quantity:     number;
  unit_price:   number;
  notes?:       string;
}

function calcTotals(items: ItemPayload[], discount = 0, shipping = 0) {
  const subtotal = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0);
  return { subtotal, total: subtotal - Number(discount) + Number(shipping) };
}

export const ordersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/orders ─────────────────────────────────────────────────── */
  fastify.get('/orders', async (request, reply) => {
    const { tenant_id, status, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const params: unknown[] = [tenant_id];
    let where = '';

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND o.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      where += ` AND (o.number ILIKE $${n} OR COALESCE(c.company_name, c.full_name) ILIKE $${n})`;
    }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      pool.query(
        `SELECT o.id, o.number, o.status, o.subtotal, o.discount, o.shipping, o.total,
                o.notes, o.created_at,
                c.id AS client_id,
                COALESCE(c.company_name, c.full_name) AS client_name
         FROM orders o
         JOIN clients c ON c.id = o.client_id
         WHERE o.tenant_id = $1${where}
         ORDER BY o.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) FROM orders o
         JOIN clients c ON c.id = o.client_id
         WHERE o.tenant_id = $1${where}`,
        params,
      ),
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Atomic sequential number via CTE
      const { rows: [order] } = await client.query(
        `WITH next AS (
           SELECT COALESCE(
             MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INTEGER END), 0
           ) + 1 AS n
           FROM orders WHERE tenant_id = $1
         )
         INSERT INTO orders
           (tenant_id, client_id, number, notes, subtotal, discount, shipping, total, created_by)
         SELECT $1, $2, LPAD(n::TEXT, 5, '0'), $3, $4, $5, $6, $7, $8
         FROM next
         RETURNING id, number, status, total`,
        [tenant_id, client_id, notes || null, subtotal, discount, shipping, total, created_by || null],
      );

      for (const it of items as ItemPayload[]) {
        await client.query(
          `INSERT INTO order_items
             (order_id, material_id, name, sku, unit, quantity, unit_price, total, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [order.id, it.material_id || null, it.name, it.sku || null,
           it.unit || 'UN', it.quantity, it.unit_price,
           Number(it.quantity) * Number(it.unit_price), it.notes || null],
        );
      }

      await client.query('COMMIT');
      return reply.code(201).send(order);
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') return reply.conflict('Número de pedido já existe');
      throw err;
    } finally {
      client.release();
    }
  });

  /* ── GET /v1/orders/:id ─────────────────────────────────────────────── */
  fastify.get('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [{ rows: [order] }, { rows: items }] = await Promise.all([
      pool.query(
        `SELECT o.*,
                COALESCE(c.company_name, c.full_name) AS client_name,
                c.person_type, c.cnpj, c.cpf
         FROM orders o JOIN clients c ON c.id = o.client_id
         WHERE o.id = $1`,
        [id],
      ),
      pool.query(
        `SELECT oi.* FROM order_items oi WHERE oi.order_id = $1 ORDER BY oi.created_at`,
        [id],
      ),
    ]);
    if (!order) return reply.notFound('Pedido não encontrado');
    return { ...order, items };
  });

  /* ── PATCH /v1/orders/:id ───────────────────────────────────────────── */
  fastify.patch('/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { client_id, notes, discount, shipping, items } = request.body as any;

    const { rows: [order] } = await pool.query(
      'SELECT id, tenant_id, status FROM orders WHERE id = $1', [id],
    );
    if (!order)             return reply.notFound('Pedido não encontrado');
    if (order.status !== 'draft') return reply.badRequest('Apenas pedidos em rascunho podem ser editados');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;

      if (client_id !== undefined) { sets.push(`client_id = $${i++}`); vals.push(client_id); }
      if (notes     !== undefined) { sets.push(`notes = $${i++}`);     vals.push(notes);     }
      if (discount  !== undefined) { sets.push(`discount = $${i++}`);  vals.push(discount);  }
      if (shipping  !== undefined) { sets.push(`shipping = $${i++}`);  vals.push(shipping);  }

      if (Array.isArray(items)) {
        await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
        const { subtotal, total } = calcTotals(items, discount ?? 0, shipping ?? 0);
        sets.push(`subtotal = $${i++}`); vals.push(subtotal);
        sets.push(`total = $${i++}`);    vals.push(total);

        for (const it of items as ItemPayload[]) {
          await client.query(
            `INSERT INTO order_items
               (order_id, material_id, name, sku, unit, quantity, unit_price, total, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, it.material_id || null, it.name, it.sku || null,
             it.unit || 'UN', it.quantity, it.unit_price,
             Number(it.quantity) * Number(it.unit_price), it.notes || null],
          );
        }
      }

      if (sets.length) {
        vals.push(id);
        await client.query(
          `UPDATE orders SET ${sets.join(', ')} WHERE id = $${i}`,
          vals,
        );
      }

      await client.query('COMMIT');
      const { rows: [updated] } = await pool.query(
        `SELECT o.*, COALESCE(c.company_name, c.full_name) AS client_name
         FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = $1`, [id],
      );
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /* ── POST /v1/orders/:id/confirm ────────────────────────────────────── */
  fastify.post('/orders/:id/confirm', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [order] } = await pool.query(
      'SELECT id, tenant_id, status FROM orders WHERE id = $1', [id],
    );
    if (!order)              return reply.notFound('Pedido não encontrado');
    if (order.status !== 'draft') return reply.badRequest('Apenas rascunhos podem ser confirmados');

    const { rows: items } = await pool.query(
      'SELECT * FROM order_items WHERE order_id = $1', [id],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct inventory for each material item
      for (const it of items) {
        if (!it.material_id) continue;
        const { rows: [inv] } = await client.query(
          'SELECT id, quantity FROM inventory WHERE tenant_id = $1 AND material_id = $2',
          [order.tenant_id, it.material_id],
        );
        if (!inv) continue; // service items have no inventory row

        const before  = Number(inv.quantity);
        const after   = before - Number(it.quantity);

        await client.query(
          'UPDATE inventory SET quantity = $1 WHERE id = $2',
          [after, inv.id],
        );
        await client.query(
          `INSERT INTO inventory_movements
             (tenant_id, material_id, movement_type, quantity, quantity_before, quantity_after,
              reason, reference_id, reference_type)
           VALUES ($1, $2, 'out', $3, $4, $5, 'Pedido confirmado', $6, 'order')`,
          [order.tenant_id, it.material_id, it.quantity, before, after, id],
        );
      }

      await client.query(
        "UPDATE orders SET status = 'confirmed' WHERE id = $1", [id],
      );
      await client.query('COMMIT');

      // Fire-and-forget notification — failure must not roll back the confirmed order
      pool.query(
        `SELECT o.number, o.total,
                COALESCE(c.company_name, c.full_name) AS client_name,
                c.email AS client_email
         FROM orders o
         LEFT JOIN clients c ON c.id = o.client_id
         WHERE o.id = $1`,
        [id],
      ).then(({ rows: [ord] }) => {
        if (!ord?.client_email) return;
        return sendNotificationIfEnabled({
          tenant_id: order.tenant_id,
          type:      'order_confirmed',
          recipient: { email: ord.client_email, name: ord.client_name ?? '' },
          data:      { order_number: ord.number, total: Number(ord.total).toFixed(2) },
        });
      }).catch(err => fastify.log.warn({ event: 'notification_enqueue_warn', error: String(err) }));

      return { ok: true, status: 'confirmed' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /* ── POST /v1/orders/:id/deliver ────────────────────────────────────── */
  fastify.post('/orders/:id/deliver', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [order] } = await pool.query(
      'SELECT id, status FROM orders WHERE id = $1', [id],
    );
    if (!order)                   return reply.notFound('Pedido não encontrado');
    if (order.status !== 'confirmed' && order.status !== 'invoiced')
      return reply.badRequest('Apenas pedidos confirmados ou faturados podem ser entregues');

    await pool.query("UPDATE orders SET status = 'delivered' WHERE id = $1", [id]);
    return { ok: true, status: 'delivered' };
  });

  /* ── POST /v1/orders/:id/cancel ─────────────────────────────────────── */
  fastify.post('/orders/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [order] } = await pool.query(
      'SELECT id, tenant_id, status FROM orders WHERE id = $1', [id],
    );
    if (!order) return reply.notFound('Pedido não encontrado');
    if (order.status === 'cancelled') return reply.badRequest('Pedido já cancelado');
    if (order.status === 'delivered') return reply.badRequest('Pedido já entregue não pode ser cancelado');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Restore inventory only if order was confirmed (had inventory deducted)
      if (order.status === 'confirmed' || order.status === 'invoiced') {
        const { rows: movements } = await client.query(
          `SELECT * FROM inventory_movements
           WHERE reference_id = $1 AND reference_type = 'order' AND movement_type = 'out'`,
          [id],
        );
        for (const mov of movements) {
          const { rows: [inv] } = await client.query(
            'SELECT id, quantity FROM inventory WHERE tenant_id = $1 AND material_id = $2',
            [order.tenant_id, mov.material_id],
          );
          if (!inv) continue;
          const before = Number(inv.quantity);
          const after  = before + Number(mov.quantity);
          await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [after, inv.id]);
          await client.query(
            `INSERT INTO inventory_movements
               (tenant_id, material_id, movement_type, quantity, quantity_before, quantity_after,
                reason, reference_id, reference_type)
             VALUES ($1, $2, 'return', $3, $4, $5, 'Pedido cancelado', $6, 'order')`,
            [order.tenant_id, mov.material_id, mov.quantity, before, after, id],
          );
        }
      }

      await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [id]);
      await client.query('COMMIT');
      return { ok: true, status: 'cancelled' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });
};
