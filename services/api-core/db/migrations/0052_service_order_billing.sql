-- Faturamento de Ordem de Serviço: liga um receivable a uma OS concluída.
-- UNIQUE (parcial, só quando não nulo) é a própria trava de idempotência no
-- banco — no máximo um faturamento por OS, nunca dois (mesmo espírito do
-- UNIQUE de idempotency_key já usado em comissão de vendedor).

ALTER TABLE receivables
  ADD COLUMN IF NOT EXISTS service_order_id UUID REFERENCES service_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_receivables_service_order
  ON receivables(service_order_id) WHERE service_order_id IS NOT NULL;
