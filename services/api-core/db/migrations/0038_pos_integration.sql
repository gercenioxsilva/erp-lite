-- 0031_pos_integration.sql
-- Integra o PDV ao restante do ERP:
--   1) Vincula contas a receber à venda PDV de origem, para a receita do PDV
--      aparecer no financeiro (Dashboard / Fluxo de Caixa / Relatórios).
--   2) Fecha a FK que faltava em pos_cash_movements.sale_id (integridade).
-- Estoque geral (inventory_movements com reference_type='pos_sale') e os
-- receivables por forma de pagamento são gravados em código (posSaleService).

-- 1) receivables.pos_sale_id ──────────────────────────────────────────────────
ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS pos_sale_id uuid REFERENCES pos_sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receivables_pos_sale
  ON receivables (tenant_id, pos_sale_id)
  WHERE pos_sale_id IS NOT NULL;

-- 2) FK órfã em pos_cash_movements.sale_id ───────────────────────────────────
ALTER TABLE pos_cash_movements
  ADD CONSTRAINT pos_cash_movements_sale_fk
  FOREIGN KEY (sale_id) REFERENCES pos_sales(id) ON DELETE SET NULL;
