-- Prazo de entrega (texto livre) e forma de pagamento (lista pré-definida) na proposta.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS delivery_time  VARCHAR(120);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40);
