import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';

export const reportsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /v1/reports/overdue — Inadimplência: receivables past due date
  fastify.get('/reports/overdue', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const result = await db.execute<any>(sql`
      SELECT
        r.id,
        r.description,
        r.amount,
        r.paid_amount,
        r.due_date,
        COALESCE(c.trade_name, c.company_name, c.full_name) AS client_name,
        (CURRENT_DATE - r.due_date::date)                   AS days_overdue
      FROM receivables r
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.tenant_id = ${tenantId}
        AND r.status    IN ('pending', 'partial')
        AND r.due_date::date < CURRENT_DATE
      ORDER BY r.due_date ASC
    `);

    const rows = result.rows.map(r => ({
      id:          String(r.id),
      description: String(r.description),
      amount:      Number(r.amount),
      paid_amount: Number(r.paid_amount),
      remaining:   Number(r.amount) - Number(r.paid_amount),
      due_date:    String(r.due_date),
      client_name: r.client_name ? String(r.client_name) : null,
      days_overdue: Number(r.days_overdue),
    }));

    return {
      rows,
      total_overdue: rows.reduce((a, r) => a + r.remaining, 0),
      count:         rows.length,
    };
  });

  // GET /v1/reports/top-products?days=30 — Top products by revenue (from confirmed orders)
  fastify.get('/reports/top-products', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;
    const days     = Math.min(Math.max(Number(query.days ?? 30), 1), 365);

    const result = await db.execute<any>(sql`
      SELECT
        COALESCE(m.name, oi.name)               AS name,
        m.sku,
        SUM(oi.quantity)                         AS total_qty,
        SUM(oi.quantity * oi.unit_price)         AS total_revenue,
        COUNT(DISTINCT oi.order_id)              AS order_count
      FROM order_items oi
      JOIN orders o     ON o.id = oi.order_id AND o.tenant_id = ${tenantId}
      LEFT JOIN materials m ON m.id = oi.material_id AND m.tenant_id = ${tenantId}
      WHERE o.status     IN ('confirmed', 'invoiced', 'delivered')
        AND o.created_at >= CURRENT_DATE - (${days}::text || ' days')::interval
      GROUP BY COALESCE(m.name, oi.name), m.sku
      ORDER BY total_revenue DESC
      LIMIT 20
    `);

    return {
      rows: result.rows.map(r => ({
        name:          String(r.name),
        sku:           r.sku ? String(r.sku) : null,
        total_qty:     Number(r.total_qty),
        total_revenue: Number(r.total_revenue),
        order_count:   Number(r.order_count),
      })),
      days,
    };
  });
};
