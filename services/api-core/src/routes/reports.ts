import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { computeDRE } from '../services/dreService';

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

  // GET /v1/reports/commissions?from=&to= — Ranking de comissão por vendedor
  fastify.get('/reports/commissions', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { from, to } = request.query as Record<string, string>;

    const fromFilter = from ? sql`AND ce.created_at >= ${from}::timestamptz` : sql``;
    const toFilter   = to   ? sql`AND ce.created_at <= ${to}::timestamptz`   : sql``;

    const result = await db.execute<any>(sql`
      SELECT
        s.id                                                              AS seller_id,
        s.name                                                            AS seller_name,
        COUNT(*) FILTER (WHERE ce.status = 'accrued')                     AS sale_count,
        COALESCE(SUM(ce.commission_amount) FILTER (WHERE ce.status = 'accrued'),   0) AS total_accrued,
        COALESCE(SUM(ce.commission_amount) FILTER (WHERE ce.status = 'cancelled'), 0) AS total_cancelled
      FROM sellers s
      JOIN commission_entries ce ON ce.seller_id = s.id
      WHERE s.tenant_id = ${tenantId} ${fromFilter} ${toFilter}
      GROUP BY s.id, s.name
      ORDER BY total_accrued DESC
    `);

    const rows = result.rows.map(r => ({
      seller_id:       String(r.seller_id),
      seller_name:     String(r.seller_name),
      sale_count:      Number(r.sale_count),
      total_accrued:   Number(r.total_accrued),
      total_cancelled: Number(r.total_cancelled),
    }));

    return {
      rows,
      total_accrued: rows.reduce((a, r) => a + r.total_accrued, 0),
    };
  });

  // GET /v1/reports/dre?from=YYYY-MM-DD&to=YYYY-MM-DD — DRE Gerencial
  fastify.get('/reports/dre', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { from, to } = request.query as Record<string, string>;

    if (!from || !to) return reply.badRequest('Parâmetros from e to são obrigatórios (formato YYYY-MM-DD)');

    const dre = await computeDRE({ tenantId, from, to }, db);
    return dre;
  });

  // GET /v1/dre/categories — lista categorias DRE disponíveis para o tenant
  fastify.get('/dre/categories', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const { rows } = await db.execute<any>(sql`
      SELECT id, code, name, type, sign, sort_order
      FROM dre_categories
      WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL) AND is_active = true
      ORDER BY sort_order ASC
    `);

    return rows;
  });
};
