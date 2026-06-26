import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/dashboard', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const [recvResult, payResult, invoiceResult, ordersResult, revenueResult] = await Promise.all([
      // Receivables: pending/overdue amounts
      db.execute<any>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','partial'))                                               AS pending_count,
          COALESCE(SUM(amount - paid_amount) FILTER (WHERE status IN ('pending','partial')), 0)                AS pending_amount,
          COUNT(*) FILTER (WHERE status IN ('pending','partial') AND due_date < CURRENT_DATE)                  AS overdue_count,
          COALESCE(SUM(amount - paid_amount) FILTER (WHERE status IN ('pending','partial') AND due_date < CURRENT_DATE), 0) AS overdue_amount
        FROM receivables WHERE tenant_id = ${tenantId} AND status != 'cancelled'
      `),
      // Payables: due this week + overdue
      db.execute<any>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','partial') AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS due_week_count,
          COALESCE(SUM(amount - paid_amount) FILTER (WHERE status IN ('pending','partial') AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7), 0) AS due_week_amount,
          COUNT(*) FILTER (WHERE status IN ('pending','partial') AND due_date < CURRENT_DATE)                            AS overdue_count,
          COALESCE(SUM(amount - paid_amount) FILTER (WHERE status IN ('pending','partial') AND due_date < CURRENT_DATE), 0) AS overdue_amount
        FROM payables WHERE tenant_id = ${tenantId} AND status != 'cancelled'
      `),
      // Invoices: revenue this month vs last month
      db.execute<any>(sql`
        SELECT
          COALESCE(SUM(total) FILTER (WHERE DATE_TRUNC('month', issue_date::date) = DATE_TRUNC('month', CURRENT_DATE)), 0)                                AS revenue_this_month,
          COALESCE(SUM(total) FILTER (WHERE DATE_TRUNC('month', issue_date::date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')), 0)           AS revenue_last_month
        FROM invoices WHERE tenant_id = ${tenantId} AND status = 'issued'
      `),
      // Orders pending
      db.execute<any>(sql`
        SELECT COUNT(*) AS pending_orders FROM orders
        WHERE tenant_id = ${tenantId} AND status = 'confirmed'
      `),
      // Revenue by month — last 6 months
      db.execute<any>(sql`
        SELECT TO_CHAR(DATE_TRUNC('month', issue_date::date), 'YYYY-MM') AS month,
               COALESCE(SUM(total), 0)                                    AS total
        FROM invoices
        WHERE tenant_id = ${tenantId} AND status = 'issued'
          AND issue_date::date >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY 1 ORDER BY 1
      `),
    ]);

    const recv    = recvResult.rows[0]   || {};
    const pay     = payResult.rows[0]    || {};
    const inv     = invoiceResult.rows[0] || {};
    const orders  = ordersResult.rows[0] || {};

    return {
      receivables: {
        pending_count:  Number(recv.pending_count  || 0),
        pending_amount: Number(recv.pending_amount || 0),
        overdue_count:  Number(recv.overdue_count  || 0),
        overdue_amount: Number(recv.overdue_amount || 0),
      },
      payables: {
        due_week_count:  Number(pay.due_week_count  || 0),
        due_week_amount: Number(pay.due_week_amount || 0),
        overdue_count:   Number(pay.overdue_count   || 0),
        overdue_amount:  Number(pay.overdue_amount  || 0),
      },
      revenue: {
        this_month: Number(inv.revenue_this_month || 0),
        last_month: Number(inv.revenue_last_month || 0),
      },
      orders: {
        pending_count: Number(orders.pending_orders || 0),
      },
      revenue_by_month: revenueResult.rows.map(r => ({
        month: String(r.month),
        total: Number(r.total),
      })),
    };
  });
};
