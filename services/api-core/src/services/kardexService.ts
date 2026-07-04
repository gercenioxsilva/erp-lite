// Application Service — Kardex / Giro de Estoque. Dois modos:
//   material_id presente → ledger cronológico daquele material + resumo.
//   material_id ausente  → ranking dos 30 materiais com mais movimentações no
//                          período, cada um com seu próprio resumo.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildKardexSummary, type MovementInput } from '../domain/kardex/kardexDomain';

interface KardexArgs {
  tenantId: string;
  from: string;
  to: string;
  materialId?: string;
}

const RANKING_LIMIT = 30;

export async function computeKardex(args: KardexArgs, db: DrizzleDB) {
  const { tenantId, from, to, materialId } = args;

  if (materialId) {
    const [{ rows: materialRows }, { rows: movementRows }] = await Promise.all([
      db.execute<any>(sql`
        SELECT name, sku FROM materials WHERE id = ${materialId} AND tenant_id = ${tenantId}
      `),
      db.execute<any>(sql`
        SELECT movement_type, quantity, quantity_before, quantity_after, reason, created_at
        FROM inventory_movements
        WHERE tenant_id = ${tenantId} AND material_id = ${materialId}
          AND created_at::date BETWEEN ${from}::date AND ${to}::date
        ORDER BY created_at ASC
      `),
    ]);

    const material = materialRows[0] ? { id: materialId, name: String(materialRows[0].name), sku: materialRows[0].sku ? String(materialRows[0].sku) : null } : null;

    const movements = movementRows.map(r => ({
      movement_type:   String(r.movement_type),
      quantity:        Number(r.quantity),
      quantity_before: Number(r.quantity_before),
      quantity_after:  Number(r.quantity_after),
      reason:          r.reason ? String(r.reason) : null,
      created_at:      String(r.created_at),
    }));

    const summaryInput: MovementInput[] = movements.map(m => ({ movement_type: m.movement_type as MovementInput['movement_type'], quantity: m.quantity }));

    return { mode: 'detail' as const, material, movements, summary: buildKardexSummary(summaryInput) };
  }

  const { rows } = await db.execute<any>(sql`
    SELECT
      im.material_id::text                                            AS material_id,
      m.name                                                          AS name,
      m.sku                                                           AS sku,
      COALESCE(SUM(im.quantity) FILTER (WHERE im.movement_type IN ('in','return')), 0)  AS total_in,
      COALESCE(SUM(ABS(im.quantity)) FILTER (WHERE im.movement_type = 'out'), 0)        AS total_out,
      COALESCE(SUM(im.quantity), 0)                                    AS net,
      COUNT(*)                                                        AS movement_count
    FROM inventory_movements im
    JOIN materials m ON m.id = im.material_id
    WHERE im.tenant_id = ${tenantId}
      AND im.created_at::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY im.material_id, m.name, m.sku
    ORDER BY movement_count DESC
    LIMIT ${RANKING_LIMIT}
  `);

  return {
    mode: 'summary' as const,
    rows: rows.map(r => ({
      material_id:     String(r.material_id),
      name:            String(r.name),
      sku:             r.sku ? String(r.sku) : null,
      total_in:        Number(r.total_in),
      total_out:       Number(r.total_out),
      net:             Number(r.net),
      movement_count:  Number(r.movement_count),
    })),
  };
}
