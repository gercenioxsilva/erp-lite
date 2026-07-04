// Application Service — Curva ABC de Produtos. Agrega faturamento/margem por
// produto a partir de order_items (mesmo padrão de query de '/reports/top-products')
// e delega a classificação ABC ao domínio puro.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildAbcCurve, type AbcItemInput } from '../domain/abc/abcDomain';

interface AbcArgs {
  tenantId: string;
  from: string;
  to: string;
  metric: 'revenue' | 'margin';
}

export async function computeAbc(args: AbcArgs, db: DrizzleDB) {
  const { tenantId, from, to, metric } = args;

  const { rows } = await db.execute<any>(sql`
    SELECT
      COALESCE(m.name, oi.name)                                    AS name,
      m.sku                                                        AS sku,
      SUM(oi.quantity)                                             AS quantity,
      SUM(oi.quantity * oi.unit_price)                             AS revenue,
      SUM(oi.quantity * (oi.unit_price - COALESCE(m.cost_price,0))) AS margin
    FROM order_items oi
    JOIN orders o     ON o.id = oi.order_id AND o.tenant_id = ${tenantId}
    LEFT JOIN materials m ON m.id = oi.material_id AND m.tenant_id = ${tenantId}
    WHERE o.status     IN ('confirmed', 'invoiced', 'delivered')
      AND o.created_at::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY COALESCE(m.name, oi.name), m.sku
  `);

  const items: AbcItemInput[] = rows.map(r => ({
    name:     String(r.name),
    sku:      r.sku ? String(r.sku) : null,
    quantity: Number(r.quantity),
    revenue:  Number(r.revenue),
    margin:   Number(r.margin),
  }));

  return buildAbcCurve(items, metric);
}
