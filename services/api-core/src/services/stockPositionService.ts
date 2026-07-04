// Application Service — Posição de Estoque. Lê inventory + materials (itens
// ativos que controlam estoque) e delega a classificação ao domínio puro.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildStockPosition, type StockItemInput } from '../domain/stockPosition/stockPositionDomain';

interface StockPositionArgs {
  tenantId: string;
}

export async function computeStockPosition(args: StockPositionArgs, db: DrizzleDB) {
  const { tenantId } = args;

  const { rows } = await db.execute<any>(sql`
    SELECT
      inv.material_id::text AS id,
      m.name                AS name,
      m.sku                 AS sku,
      m.category            AS category,
      inv.quantity           AS quantity,
      inv.min_qty            AS min_qty,
      inv.max_qty            AS max_qty,
      m.sale_price           AS sale_price,
      m.cost_price           AS cost_price
    FROM inventory inv
    JOIN materials m ON m.id = inv.material_id
    WHERE inv.tenant_id = ${tenantId}
      AND m.is_active = true
      AND m.tracks_inventory = true
  `);

  const items: StockItemInput[] = rows.map(r => ({
    id:         String(r.id),
    name:       String(r.name),
    sku:        r.sku ? String(r.sku) : null,
    category:   r.category ? String(r.category) : null,
    quantity:   Number(r.quantity),
    min_qty:    Number(r.min_qty),
    max_qty:    r.max_qty != null ? Number(r.max_qty) : null,
    sale_price: Number(r.sale_price),
    cost_price: Number(r.cost_price),
  }));

  return buildStockPosition(items);
}
