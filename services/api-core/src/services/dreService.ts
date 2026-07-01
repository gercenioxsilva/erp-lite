// Application Service — DRE Gerencial (P3)
// Lê dados existentes (invoices para receita, payables para despesas) e aplica
// a fórmula do domínio. Abordagem Caminho A — sem contabilidade de dupla entrada.
//
// A receita vem automaticamente das NF-e autorizadas (status='issued').
// As despesas vêm dos payables classificados via dre_category_id.
// Payables sem categoria aparecem em 'outras_despesas' por default.

import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { buildDRE, type DRECategory, type DRELineType } from '../domain/dre/dreDomain';

export type DrizzleDB = typeof _db;

interface DREQueryArgs {
  tenantId: string;
  from:     string; // ISO date YYYY-MM-DD
  to:       string;
}

export async function computeDRE(args: DREQueryArgs, db: DrizzleDB) {
  const { tenantId, from, to } = args;

  // 1. Busca receita bruta das notas fiscais emitidas no período
  const { rows: [revenueRow] } = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE tenant_id = ${tenantId}
      AND status    IN ('issued')
      AND issue_date >= ${from}::date
      AND issue_date <= ${to}::date
  `);
  const receita_bruta = Number(revenueRow?.total ?? 0);

  // 2. Busca cancelamentos de notas no período (deduções da receita)
  const { rows: [cancelRow] } = await db.execute<{ total: string }>(sql`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM invoices
    WHERE tenant_id = ${tenantId}
      AND status    = 'cancelled'
      AND nfe_status = 'authorized'   -- só notas que chegaram a ser autorizadas e depois canceladas
      AND issue_date >= ${from}::date
      AND issue_date <= ${to}::date
  `);
  const deducoes_raw = Number(cancelRow?.total ?? 0);

  // 3. Busca as categorias DRE do tenant (globais + personalizadas)
  const { rows: catRows } = await db.execute<{
    id: string; code: string; name: string; type: string; sign: number; sort_order: number;
  }>(sql`
    SELECT id, code, name, type, sign, sort_order
    FROM dre_categories
    WHERE (tenant_id = ${tenantId} OR tenant_id IS NULL) AND is_active = true
    ORDER BY sort_order ASC
  `);

  // 4. Busca totais de despesas por categoria no período
  const { rows: expRows } = await db.execute<{ dre_category_id: string | null; total: string }>(sql`
    SELECT dre_category_id, COALESCE(SUM(amount), 0) AS total
    FROM payables
    WHERE tenant_id = ${tenantId}
      AND status IN ('paid', 'partial', 'pending')
      AND due_date >= ${from}::date
      AND due_date <= ${to}::date
    GROUP BY dre_category_id
  `);

  // Mapeia category_id → total de despesas
  const expenseByCategory = new Map<string | null, number>();
  for (const r of expRows) {
    expenseByCategory.set(r.dre_category_id, Number(r.total));
  }

  // 5. Constrói array de DRECategory com os valores
  const categories: DRECategory[] = [];

  // Linha de receita bruta (sempre presente)
  categories.push({
    id:         'revenue-auto',
    code:       'receita_bruta',
    name:       'Receita Bruta de Vendas e Serviços',
    type:       'revenue',
    sign:       1,
    sort_order: 10,
    amount:     receita_bruta,
  });

  // Linha de deduções (só se houver cancelamentos)
  if (deducoes_raw > 0) {
    categories.push({
      id:         'deduction-auto',
      code:       'deducoes',
      name:       'Deduções da Receita Bruta (cancelamentos)',
      type:       'deduction',
      sign:       -1,
      sort_order: 20,
      amount:     -deducoes_raw, // negativo = deduz
    });
  }

  // Categorias configuradas com despesas do período
  const othersCatId = catRows.find(c => c.code === 'outras_despesas')?.id ?? null;
  let uncategorizedTotal = 0;

  for (const cat of catRows) {
    if (cat.code === 'receita_bruta' || cat.code === 'deducoes') continue; // já tratamos acima
    const amount = expenseByCategory.get(cat.id) ?? 0;
    if (amount === 0 && cat.type !== 'cogs') continue; // omite linhas sem movimento (exceto CMV)

    categories.push({
      id:         cat.id,
      code:       cat.code,
      name:       cat.name,
      type:       cat.type as DRELineType,
      sign:       cat.sign as 1 | -1,
      sort_order: cat.sort_order,
      amount:     cat.sign === -1 ? -amount : amount, // despesas ficam negativas
    });
  }

  // Despesas sem categoria → "Outras Despesas"
  uncategorizedTotal = expenseByCategory.get(null) ?? 0;
  if (uncategorizedTotal > 0) {
    categories.push({
      id:         othersCatId ?? 'other-uncategorized',
      code:       'outras_despesas',
      name:       'Outras Despesas (não classificadas)',
      type:       'other',
      sign:       -1,
      sort_order: 100,
      amount:     -uncategorizedTotal,
    });
  }

  return buildDRE(from, to, categories);
}
