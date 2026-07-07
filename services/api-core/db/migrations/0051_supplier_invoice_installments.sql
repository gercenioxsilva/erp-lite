-- Parcelamento de NF-e de Entrada: uma nota pode ser paga em N vezes, cada
-- parcela vira sua própria conta a pagar (payables), com vencimento mensal
-- automático e valor dividido igualmente (resto de centavos na última).
--
-- installment_group_id NÃO é FK — é só um id de correlação compartilhado
-- pelas N parcelas de uma mesma nota (mesmo padrão de
-- material_price_history.import_batch_id, migration 0050). Deliberadamente
-- não reaproveita payables.parent_payable_id, que já tem semântica própria
-- (ligar uma ocorrência recorrente ao payable-modelo).

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS installments         SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS installment_group_id UUID;

ALTER TABLE payables
  ADD COLUMN IF NOT EXISTS installment_number   SMALLINT,
  ADD COLUMN IF NOT EXISTS installment_total    SMALLINT,
  ADD COLUMN IF NOT EXISTS installment_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_payables_installment_group
  ON payables(tenant_id, installment_group_id) WHERE installment_group_id IS NOT NULL;
