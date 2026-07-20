-- Migration 0082: Tesouraria Open Finance — saldos por conta, conciliação de
-- DÉBITOS contra contas a pagar e categoria da transação.
--
-- Até aqui a conciliação só olhava CRÉDITOS (receita ↔ receivables); débitos
-- do extrato viravam 'unmatched' para sempre. Agora um débito casa contra
-- payables abertos (valor/documento do fornecedor/vencimento) e a confirmação
-- registra o pagamento (payable_payments) — o ciclo financeiro fecha nos dois
-- sentidos, como nos ERPs grandes (Conta Azul/Omie).

-- Saldo por conta, atualizado a cada sync (fonte: Pluggy accounts.balance).
ALTER TABLE bank_connection_accounts ADD COLUMN balance NUMERIC(15,2);
ALTER TABLE bank_connection_accounts ADD COLUMN balance_synced_at TIMESTAMPTZ;

-- Categoria da transação (taxonomia da Pluggy) — insumo de relatórios e de
-- futuras regras de categorização; nullable, uploads OFX/CSV não têm.
ALTER TABLE imported_transactions ADD COLUMN category VARCHAR(80);

-- Débito conciliado aponta para a conta a pagar + o pagamento registrado
-- (espelho de receivable_id/receivable_payment_id).
ALTER TABLE reconciliation_matches ADD COLUMN payable_id UUID REFERENCES payables(id) ON DELETE SET NULL;
ALTER TABLE reconciliation_matches ADD COLUMN payable_payment_id UUID REFERENCES payable_payments(id) ON DELETE SET NULL;

-- target_type ganha 'payable' — CHECK novo é superset do antigo (prod-safe).
ALTER TABLE reconciliation_matches DROP CONSTRAINT IF EXISTS reconciliation_matches_target_type_check;
ALTER TABLE reconciliation_matches ADD CONSTRAINT reconciliation_matches_target_type_check
  CHECK (target_type IN ('receivable','order','service_order','contract','scheduling_session','pos_sale','manual','payable'));
