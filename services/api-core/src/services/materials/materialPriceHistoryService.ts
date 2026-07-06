// Grava o histórico de preço (material_price_history) — sempre chamado
// dentro da MESMA transação do UPDATE em materials (nunca separado), mesma
// garantia de atomicidade já usada por cost_center_movements/commission_entries.
// Só insere linha quando algo de fato mudou — nunca grava "sem alteração".

import { materialPriceHistory } from '../../db/schema';
import { diffMaterialPrice, type MaterialPriceSnapshot, type MaterialPriceInput } from '../../domain/materials/materialPriceHistoryDomain';

export type PriceChangeSource = 'manual_edit' | 'bulk_import';

export interface RecordPriceChangeArgs {
  tenantId: string;
  materialId: string;
  current: MaterialPriceSnapshot;
  incoming: MaterialPriceInput;
  source: PriceChangeSource;
  importBatchId?: string;
  createdBy?: string | null;
}

// `tx` é o handle de transação já aberto pelo chamador (mesmo padrão de
// `replaceKitComponents(tx: any, ...)` em routes/materials.ts) — Drizzle
// distingue o tipo de uma `PgTransaction` do `NodePgDatabase` completo, e essa
// função só precisa do `.insert()`, então tipar como `any` evita fricção sem
// perder a garantia real de atomicidade (quem chama decide a transação).
export async function recordPriceChangeIfNeeded(tx: any, args: RecordPriceChangeArgs): Promise<boolean> {
  const diff = diffMaterialPrice(args.current, args.incoming);
  if (!diff.hasChanges) return false;

  await tx.insert(materialPriceHistory).values({
    tenant_id: args.tenantId,
    material_id: args.materialId,
    sale_price_before: diff.sale_price.changed ? String(diff.sale_price.before) : null,
    sale_price_after: diff.sale_price.changed ? String(diff.sale_price.after) : null,
    cost_price_before: diff.cost_price.changed ? String(diff.cost_price.before) : null,
    cost_price_after: diff.cost_price.changed ? String(diff.cost_price.after) : null,
    source: args.source,
    import_batch_id: args.importBatchId ?? null,
    created_by: args.createdBy ?? null,
  });

  return true;
}
