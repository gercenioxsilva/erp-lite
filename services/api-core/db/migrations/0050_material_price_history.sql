-- Histórico de alteração de preço de materiais — append-only (mesmo padrão de
-- cost_center_movements/commission_entries), nunca UPDATE/DELETE depois do
-- insert. Uma linha por EVENTO de mudança (venda e custo juntos numa mesma
-- edição/importação geram uma linha só, com os dois pares antes/depois).
--
-- Motivação: cliente reimportando planilha para atualizar preço não tinha
-- como fazer isso (SKU duplicado era sempre ignorado) nem, se pudesse, teria
-- rastro de qual preço valia antes. Ver regra correspondente no README.

CREATE TABLE IF NOT EXISTS material_price_history (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  material_id       UUID          NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sale_price_before NUMERIC(15,2),  -- NULL = venda não mudou neste evento
  sale_price_after  NUMERIC(15,2),
  cost_price_before NUMERIC(15,2),  -- NULL = custo não mudou neste evento
  cost_price_after  NUMERIC(15,2),
  source            VARCHAR(20)   NOT NULL, -- 'manual_edit' | 'bulk_import'
  import_batch_id   UUID,           -- agrupa todas as linhas de uma mesma importação
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_price_history_material
  ON material_price_history(tenant_id, material_id, created_at DESC);
