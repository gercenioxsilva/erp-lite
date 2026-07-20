-- Migration 0085: Regime tributário do cliente (regra 61/74) — travado no
-- cadastro do cliente, nunca mais perguntado na tela de emissão de NF-e.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(20);
ALTER TABLE clients DROP CONSTRAINT IF EXISTS chk_clients_tax_regime;
ALTER TABLE clients ADD CONSTRAINT chk_clients_tax_regime
  CHECK (tax_regime IS NULL OR tax_regime IN ('lucro_presumido', 'lucro_real', 'simples_nacional', 'mei'));
