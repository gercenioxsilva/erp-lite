import { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';

interface InvoiceItemPayload {
  material_id?: string;
  name:         string;
  ncm_code?:    string;
  cfop?:        string;
  quantity:     number;
  unit_price:   number;
}

export const invoicesRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/invoices ───────────────────────────────────────────────── */
  fastify.get('/invoices', async (request, reply) => {
    const { tenant_id, status, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
    const params: unknown[] = [tenant_id];
    let where = '';

    if (status && status !== 'all') {
      params.push(status);
      where += ` AND i.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      where += ` AND (i.number ILIKE $${n} OR COALESCE(c.company_name, c.full_name) ILIKE $${n})`;
    }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      pool.query(
        `SELECT i.id, i.number, i.serie, i.status, i.issue_date,
                i.subtotal, i.total, i.notes, i.order_id, i.created_at,
                COALESCE(c.company_name, c.full_name) AS client_name,
                o.number AS order_number
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         LEFT JOIN orders o ON o.id = i.order_id
         WHERE i.tenant_id = $1${where}
         ORDER BY i.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*) FROM invoices i
         JOIN clients c ON c.id = i.client_id
         WHERE i.tenant_id = $1${where}`,
        params,
      ),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/invoices ──────────────────────────────────────────────── */
  fastify.post('/invoices', async (request, reply) => {
    const { tenant_id, client_id, order_id, items, notes, serie = '1' } =
      request.body as any;
    if (!tenant_id || !client_id) return reply.badRequest('tenant_id and client_id are required');
    if (!Array.isArray(items) || !items.length) return reply.badRequest('At least one item is required');

    const subtotal = items.reduce(
      (s: number, it: InvoiceItemPayload) => s + Number(it.quantity) * Number(it.unit_price), 0,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: [invoice] } = await client.query(
        `INSERT INTO invoices
           (tenant_id, client_id, order_id, serie, notes, subtotal, total, status)
         VALUES ($1, $2, $3, $4, $5, $6, $6, 'draft')
         RETURNING id, status, serie`,
        [tenant_id, client_id, order_id || null, serie, notes || null, subtotal],
      );

      for (const it of items as InvoiceItemPayload[]) {
        await client.query(
          `INSERT INTO invoice_items
             (invoice_id, material_id, name, ncm_code, cfop, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [invoice.id, it.material_id || null, it.name, it.ncm_code || null,
           it.cfop || null, it.quantity, it.unit_price,
           Number(it.quantity) * Number(it.unit_price)],
        );
      }

      // Mark linked order as invoiced
      if (order_id) {
        await client.query(
          `UPDATE orders SET status = 'invoiced' WHERE id = $1 AND status IN ('confirmed', 'draft')`,
          [order_id],
        );
      }

      await client.query('COMMIT');
      return reply.code(201).send(invoice);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /* ── GET /v1/invoices/:id ───────────────────────────────────────────── */
  fastify.get('/invoices/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [{ rows: [invoice] }, { rows: items }] = await Promise.all([
      pool.query(
        `SELECT i.*,
                COALESCE(c.company_name, c.full_name) AS client_name,
                c.cnpj, c.cpf, c.person_type,
                o.number AS order_number
         FROM invoices i
         JOIN clients c ON c.id = i.client_id
         LEFT JOIN orders o ON o.id = i.order_id
         WHERE i.id = $1`,
        [id],
      ),
      pool.query(
        'SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at',
        [id],
      ),
    ]);
    if (!invoice) return reply.notFound('Nota fiscal não encontrada');
    return { ...invoice, items };
  });

  /* ── POST /v1/invoices/:id/issue ────────────────────────────────────── */
  fastify.post('/invoices/:id/issue', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [invoice] } = await pool.query(
      'SELECT id, tenant_id, serie, status FROM invoices WHERE id = $1', [id],
    );
    if (!invoice)                  return reply.notFound('Nota fiscal não encontrada');
    if (invoice.status !== 'draft') return reply.badRequest('Apenas rascunhos podem ser emitidos');

    // Generate sequential NF number for this tenant+serie
    const { rows: [num] } = await pool.query(
      `SELECT COALESCE(
         MAX(CASE WHEN number ~ '^[0-9]+$' THEN number::INTEGER END), 0
       ) + 1 AS n
       FROM invoices
       WHERE tenant_id = $1 AND serie = $2 AND status = 'issued'`,
      [invoice.tenant_id, invoice.serie],
    );

    const number = String(num.n).padStart(6, '0');
    await pool.query(
      `UPDATE invoices
       SET status = 'issued', number = $1, issue_date = CURRENT_DATE
       WHERE id = $2`,
      [number, id],
    );
    return { ok: true, status: 'issued', number };
  });

  /* ── POST /v1/invoices/:id/cancel ───────────────────────────────────── */
  fastify.post('/invoices/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows: [invoice] } = await pool.query(
      'SELECT id, order_id, status FROM invoices WHERE id = $1', [id],
    );
    if (!invoice)                      return reply.notFound('Nota fiscal não encontrada');
    if (invoice.status === 'cancelled') return reply.badRequest('Nota já cancelada');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [id]);

      // Revert order back to confirmed if it was invoiced by this NF-e
      if (invoice.order_id) {
        await client.query(
          `UPDATE orders SET status = 'confirmed'
           WHERE id = $1 AND status = 'invoiced'
             AND NOT EXISTS (
               SELECT 1 FROM invoices
               WHERE order_id = $1 AND status = 'issued' AND id != $2
             )`,
          [invoice.order_id, id],
        );
      }
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
