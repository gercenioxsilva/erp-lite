import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { computeDRE } from '../services/dreService';
import { computeCashflow } from '../services/cashflowService';
import { computeAging } from '../services/agingService';
import { parsePeriod } from '../lib/reportPeriod';
import { requireModule } from '../lib/requireModule';
import type { CashflowGranularity } from '../domain/cashflow/cashflowDomain';
import { computeProposalsFunnel } from '../services/proposalsFunnelService';
import { computeStockPosition } from '../services/stockPositionService';
import { computeAbc } from '../services/abcService';
import { computeKardex } from '../services/kardexService';
import { computeTechnicianProductivity } from '../services/technicianProductivityService';
import { computeMrr } from '../services/mrrService';

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

  // GET /v1/reports/cashflow?from=&to=&granularity=week|month — Fluxo de Caixa (realizado vs. projetado)
  fastify.get('/reports/cashflow', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const granularity: CashflowGranularity = query.granularity === 'month' ? 'month' : 'week';
    return computeCashflow({ tenantId, from: period.from, to: period.to, granularity }, db);
  });

  // GET /v1/reports/aging?type=receivable|payable&as_of=YYYY-MM-DD — Posição de vencimentos
  fastify.get('/reports/aging', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    const type = query.type === 'payable' ? 'payable' : 'receivable';
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.as_of ?? '')
      ? query.as_of
      : new Date().toISOString().slice(0, 10);

    if (!asOf) return reply.badRequest('Parâmetro as_of inválido (YYYY-MM-DD).');
    return computeAging({ tenantId, type, asOf }, db);
  });

  // GET /v1/reports/expenses?from=&to=&group_by=category|cost_center|dre_category — Despesas (payables)
  fastify.get('/reports/expenses', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const groupBy = ['category', 'cost_center', 'dre_category'].includes(query.group_by)
      ? query.group_by : 'category';

    // Dimensão de agrupamento: chave técnica + rótulo legível.
    const dimension =
      groupBy === 'cost_center'
        ? sql`COALESCE(cc.code || ' · ' || cc.name, 'Sem centro de custo')`
        : groupBy === 'dre_category'
          ? sql`COALESCE(dc.name, 'Sem classificação DRE')`
          : sql`p.category`;

    const joins =
      groupBy === 'cost_center'
        ? sql`LEFT JOIN cost_centers cc ON cc.id = p.cost_center_id`
        : groupBy === 'dre_category'
          ? sql`LEFT JOIN dre_categories dc ON dc.id = p.dre_category_id`
          : sql``;

    const { rows } = await db.execute<{ label: string; total: string; count: number }>(sql`
      SELECT
        ${dimension}          AS label,
        COALESCE(SUM(p.amount), 0) AS total,
        COUNT(*)              AS count
      FROM payables p
      ${joins}
      WHERE p.tenant_id = ${tenantId}
        AND p.status != 'cancelled'
        AND p.due_date BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY 1
      ORDER BY total DESC
    `);

    const mapped = rows.map(r => ({ label: String(r.label), total: Number(r.total), count: Number(r.count) }));
    return {
      group_by:  groupBy,
      from:      period.from,
      to:        period.to,
      rows:      mapped,
      total:     mapped.reduce((a, r) => a + r.total, 0),
    };
  });

  // GET /v1/reports/pos-cash?from=&to= — Fechamento de Caixa PDV (módulo opcional 'pos')
  fastify.get('/reports/pos-cash', {
    onRequest:   [(fastify as any).authenticate],
    preHandler:  [requireModule('pos')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const { rows } = await db.execute<any>(sql`
      SELECT
        s.id::text                    AS id,
        t.name                        AS terminal_name,
        u.name                        AS operator_name,
        s.opened_at::text             AS opened_at,
        s.closed_at::text             AS closed_at,
        s.opening_amount              AS opening_amount,
        s.closing_expected            AS closing_expected,
        s.closing_counted             AS closing_counted,
        s.difference                  AS difference,
        COALESCE(sup.total, 0)        AS suprimento,
        COALESCE(san.total, 0)        AS sangria,
        COALESCE(sal.cnt,   0)        AS sale_count,
        COALESCE(sal.total, 0)        AS sale_total
      FROM pos_sessions s
      JOIN pos_terminals t ON t.id = s.terminal_id
      JOIN users u         ON u.id = s.operator_id
      LEFT JOIN (SELECT session_id, SUM(amount) AS total FROM pos_cash_movements WHERE type = 'suprimento' GROUP BY 1) sup ON sup.session_id = s.id
      LEFT JOIN (SELECT session_id, SUM(amount) AS total FROM pos_cash_movements WHERE type = 'sangria'     GROUP BY 1) san ON san.session_id = s.id
      LEFT JOIN (SELECT session_id, COUNT(*) AS cnt, SUM(total) AS total FROM pos_sales WHERE status = 'finalized' GROUP BY 1) sal ON sal.session_id = s.id
      WHERE s.tenant_id = ${tenantId}
        AND s.status = 'closed'
        AND s.closed_at::date BETWEEN ${period.from}::date AND ${period.to}::date
      ORDER BY s.closed_at DESC
    `);

    const mapped = rows.map(r => ({
      id:               String(r.id),
      terminal_name:    String(r.terminal_name),
      operator_name:    String(r.operator_name),
      opened_at:        String(r.opened_at),
      closed_at:        r.closed_at ? String(r.closed_at) : null,
      opening_amount:   Number(r.opening_amount),
      closing_expected: r.closing_expected != null ? Number(r.closing_expected) : null,
      closing_counted:  r.closing_counted  != null ? Number(r.closing_counted)  : null,
      difference:       r.difference        != null ? Number(r.difference)       : null,
      suprimento:       Number(r.suprimento),
      sangria:          Number(r.sangria),
      sale_count:       Number(r.sale_count),
      sale_total:       Number(r.sale_total),
    }));

    return {
      from:  period.from,
      to:    period.to,
      rows:  mapped,
      summary: {
        session_count:    mapped.length,
        total_sales:      mapped.reduce((a, r) => a + r.sale_total, 0),
        total_difference: mapped.reduce((a, r) => a + (r.difference ?? 0), 0),
      },
    };
  });

  // GET /v1/reports/sales?from=&to=&group_by=seller|client|cost_center|month — Faturamento
  fastify.get('/reports/sales', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const groupBy = ['seller', 'client', 'cost_center', 'month'].includes(query.group_by) ? query.group_by : 'month';

    const dimension =
      groupBy === 'seller'      ? sql`COALESCE(s.name, 'Sem vendedor')` :
      groupBy === 'client'      ? sql`COALESCE(c.trade_name, c.company_name, c.full_name, 'Sem cliente')` :
      groupBy === 'cost_center' ? sql`COALESCE(cc.code || ' - ' || cc.name, 'Sem centro de custo')` :
      sql`TO_CHAR(DATE_TRUNC('month', i.issue_date), 'YYYY-MM')`;

    const joins =
      groupBy === 'seller'      ? sql`LEFT JOIN sellers s ON s.id = i.seller_id` :
      groupBy === 'client'      ? sql`LEFT JOIN clients c ON c.id = i.client_id` :
      groupBy === 'cost_center' ? sql`LEFT JOIN cost_centers cc ON cc.id = i.cost_center_id` :
      sql``;

    const { rows } = await db.execute<any>(sql`
      SELECT
        ${dimension}                         AS label,
        COALESCE(SUM(i.total), 0)            AS total_revenue,
        COUNT(*)                             AS invoice_count
      FROM invoices i
      ${joins}
      WHERE i.tenant_id = ${tenantId}
        AND i.status = 'issued'
        AND i.issue_date BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY 1
      ORDER BY total_revenue DESC
    `);

    const mapped = rows.map(r => {
      const invoice_count = Number(r.invoice_count);
      const total_revenue = Number(r.total_revenue);
      return { label: String(r.label), total_revenue, invoice_count, avg_ticket: invoice_count > 0 ? total_revenue / invoice_count : 0 };
    });

    return {
      group_by: groupBy,
      from: period.from,
      to:   period.to,
      rows: mapped,
      total_revenue:  mapped.reduce((a, r) => a + r.total_revenue, 0),
      total_invoices: mapped.reduce((a, r) => a + r.invoice_count, 0),
    };
  });

  // GET /v1/reports/proposals-funnel?from=&to= — Funil de conversão de propostas
  fastify.get('/reports/proposals-funnel', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    return computeProposalsFunnel({ tenantId, from: period.from, to: period.to }, db);
  });

  // GET /v1/reports/pos-payments?from=&to= — Vendas por forma de pagamento (módulo opcional 'pos')
  fastify.get('/reports/pos-payments', {
    onRequest:  [(fastify as any).authenticate],
    preHandler: [requireModule('pos')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const { rows } = await db.execute<any>(sql`
      SELECT psp.method AS method, COALESCE(SUM(psp.amount), 0) AS total, COUNT(*) AS count
      FROM pos_sale_payments psp
      JOIN pos_sales ps ON ps.id = psp.sale_id
      WHERE ps.tenant_id = ${tenantId}
        AND ps.status = 'finalized'
        AND ps.finalized_at::date BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY psp.method
      ORDER BY total DESC
    `);

    const mapped = rows.map(r => ({ method: String(r.method), total: Number(r.total), count: Number(r.count) }));
    return { from: period.from, to: period.to, rows: mapped, total: mapped.reduce((a, r) => a + r.total, 0) };
  });

  // GET /v1/reports/stock-position — Posição de estoque e ruptura (foto atual, sem período)
  fastify.get('/reports/stock-position', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    return computeStockPosition({ tenantId }, db);
  });

  // GET /v1/reports/abc?from=&to=&metric=revenue|margin — Curva ABC de produtos
  fastify.get('/reports/abc', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const metric = query.metric === 'margin' ? 'margin' : 'revenue';
    return computeAbc({ tenantId, from: period.from, to: period.to, metric }, db);
  });

  // GET /v1/reports/kardex?from=&to=&material_id= — Kardex / giro de estoque
  fastify.get('/reports/kardex', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    return computeKardex({ tenantId, from: period.from, to: period.to, materialId: query.material_id || undefined }, db);
  });

  // GET /v1/reports/technician-productivity?from=&to= — Produtividade/SLA por técnico (módulo opcional 'service_orders')
  fastify.get('/reports/technician-productivity', {
    onRequest:  [(fastify as any).authenticate],
    preHandler: [requireModule('service_orders')],
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    return computeTechnicianProductivity({ tenantId, from: period.from, to: period.to }, db);
  });

  // GET /v1/reports/recurring-revenue?as_of= — Receita recorrente (MRR)
  fastify.get('/reports/recurring-revenue', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(query.as_of ?? '') ? query.as_of : new Date().toISOString().slice(0, 10);
    if (!asOf) return reply.badRequest('Parâmetro as_of inválido (YYYY-MM-DD).');

    return computeMrr({ tenantId, asOf }, db);
  });

  // GET /v1/reports/supplier-spend?from=&to= — Gasto por fornecedor
  fastify.get('/reports/supplier-spend', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const [payablesResult, poResult] = await Promise.all([
      db.execute<any>(sql`
        SELECT COALESCE(supplier_name, 'Sem fornecedor identificado') AS supplier_name,
               COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
        FROM payables
        WHERE tenant_id = ${tenantId} AND status != 'cancelled'
          AND due_date BETWEEN ${period.from}::date AND ${period.to}::date
        GROUP BY 1
        ORDER BY total DESC
      `),
      db.execute<any>(sql`
        SELECT COALESCE(s.trade_name, s.company_name, s.full_name, po.supplier_name, 'Sem fornecedor') AS supplier_name,
               COALESCE(SUM(po.total) FILTER (WHERE po.status = 'approved'), 0) AS open_total,
               COUNT(*) FILTER (WHERE po.status = 'approved') AS open_count,
               COALESCE(SUM(po.total) FILTER (WHERE po.status = 'received'), 0) AS received_total,
               COUNT(*) FILTER (WHERE po.status = 'received') AS received_count
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.tenant_id = ${tenantId}
          AND po.created_at::date BETWEEN ${period.from}::date AND ${period.to}::date
        GROUP BY 1
        ORDER BY open_total DESC
      `),
    ]);

    const payables_by_supplier = payablesResult.rows.map(r => ({ supplier_name: String(r.supplier_name), total: Number(r.total), count: Number(r.count) }));
    const purchase_orders_by_supplier = poResult.rows.map(r => ({
      supplier_name:   String(r.supplier_name),
      open_total:      Number(r.open_total),
      open_count:      Number(r.open_count),
      received_total:  Number(r.received_total),
      received_count:  Number(r.received_count),
    }));

    return {
      from: period.from, to: period.to,
      payables_by_supplier,
      purchase_orders_by_supplier,
      total_spend: payables_by_supplier.reduce((a, r) => a + r.total, 0),
    };
  });

  // GET /v1/reports/tax-summary?from=&to= — Apuração de impostos / carga tributária
  fastify.get('/reports/tax-summary', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const query    = request.query as Record<string, string>;

    let period;
    try { period = parsePeriod(query); }
    catch (e) { return reply.badRequest(e instanceof Error ? e.message : 'Período inválido'); }

    const [totalsResult, byUfResult] = await Promise.all([
      db.execute<any>(sql`
        SELECT
          COALESCE(SUM(ii.icms_value), 0)       AS icms,
          COALESCE(SUM(ii.pis_value), 0)        AS pis,
          COALESCE(SUM(ii.cofins_value), 0)     AS cofins,
          COALESCE(SUM(ii.ipi_value), 0)        AS ipi,
          COALESCE(SUM(ii.fcp_value), 0)        AS fcp,
          COALESCE(SUM(ii.icms_difal_value), 0) AS icms_difal
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.tenant_id = ${tenantId} AND i.status = 'issued'
          AND i.issue_date BETWEEN ${period.from}::date AND ${period.to}::date
      `),
      db.execute<any>(sql`
        SELECT COALESCE(c.state, 'N/D') AS uf,
               COALESCE(SUM(ii.icms_value + ii.pis_value + ii.cofins_value + ii.ipi_value + ii.fcp_value + ii.icms_difal_value), 0) AS total
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.tenant_id = ${tenantId} AND i.status = 'issued'
          AND i.issue_date BETWEEN ${period.from}::date AND ${period.to}::date
        GROUP BY 1
        ORDER BY total DESC
      `),
    ]);

    const t = totalsResult.rows[0] ?? {};
    const totals = {
      icms:       Number(t.icms ?? 0),
      pis:        Number(t.pis ?? 0),
      cofins:     Number(t.cofins ?? 0),
      ipi:        Number(t.ipi ?? 0),
      fcp:        Number(t.fcp ?? 0),
      icms_difal: Number(t.icms_difal ?? 0),
    };

    return {
      from: period.from, to: period.to,
      totals,
      grand_total: Object.values(totals).reduce((a, v) => a + v, 0),
      by_uf: byUfResult.rows.map(r => ({ uf: String(r.uf), total: Number(r.total) })),
    };
  });
};
