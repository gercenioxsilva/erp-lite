-- Migration 0072: Módulo Fiscal — motor de conciliação.
--
-- Casa imported_transactions (0071) contra o ledger receivables (inclui os
-- recebíveis POS 'pending — adquirente') e, via vínculo POLIMÓRFICO
-- (target_type/target_id), contra pedidos/OS/contratos/agenda que não têm
-- receivable. Match confirmado = flip do receivable + receivable_payments
-- (reference = NSU/id bancário) na MESMA transação, via
-- registerReceivablePayment (extraído de routes/receivables.ts).
-- Este motor é o ÚNICO escritor de imported_transactions.reconciliation_status.

CREATE TABLE reconciliation_matches (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id              UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  imported_transaction_id UUID NOT NULL REFERENCES imported_transactions(id) ON DELETE CASCADE,
  -- Vínculo polimórfico: receivable é o alvo canônico; os demais cobrem
  -- fontes sem receivable (pedido/agenda) — decisão §13 do plano.
  target_type             VARCHAR(24) NOT NULL CHECK (target_type IN
                          ('receivable','order','service_order','contract','scheduling_session','pos_sale','manual')),
  target_id               UUID,
  receivable_id           UUID REFERENCES receivables(id) ON DELETE SET NULL,
  receivable_payment_id   UUID REFERENCES receivable_payments(id) ON DELETE SET NULL,
  amount_matched          NUMERIC(15,2) NOT NULL,
  score                   NUMERIC(5,4) NOT NULL DEFAULT 0,
  matched_keys            JSONB,       -- quais critérios bateram (nsu/valor/data...)
  match_method            VARCHAR(10) NOT NULL DEFAULT 'auto' CHECK (match_method IN ('auto','manual')),
  status                  VARCHAR(12) NOT NULL DEFAULT 'suggested'
                          CHECK (status IN ('suggested','confirmed','rejected','reversed')),
  dedup_key               VARCHAR(200) NOT NULL,
  matched_by              UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = sistema
  confirmed_at            TIMESTAMPTZ,
  reversed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  reversed_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Idempotência do match: re-rodar o motor nunca duplica sugestão/confirmação
-- viva para o mesmo par (transação↔alvo).
CREATE UNIQUE INDEX uq_reconciliation_match_dedup
  ON reconciliation_matches (tenant_id, dedup_key)
  WHERE status IN ('suggested','confirmed');
CREATE INDEX idx_recon_matches_tx ON reconciliation_matches (imported_transaction_id);
CREATE INDEX idx_recon_matches_status ON reconciliation_matches (tenant_id, status);

-- Regras parametrizáveis por empresa (NULL = default do tenant).
CREATE TABLE reconciliation_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id             UUID REFERENCES nfe_configs(id) ON DELETE CASCADE,
  amount_tolerance       NUMERIC(15,2) NOT NULL DEFAULT 0.01,
  date_window_days       SMALLINT      NOT NULL DEFAULT 3,
  auto_confirm_threshold NUMERIC(5,4)  NOT NULL DEFAULT 0.90,
  match_net_amount       BOOLEAN       NOT NULL DEFAULT true, -- depósito líquido vs bruto do receivable
  is_active              BOOLEAN       NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_reconciliation_rules_scope
  ON reconciliation_rules (tenant_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active;

-- Contas de adquirente (escopo do match de maquininha) — espelho de
-- bank_accounts; credentials jsonb plaintext (decisão 4, KMS Fase 2).
CREATE TABLE acquirer_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  label           VARCHAR(80) NOT NULL,
  provider        VARCHAR(30) NOT NULL,  -- cielo|rede|stone|getnet|pagseguro|mercadopago|outro
  merchant_id     VARCHAR(60),
  terminal_serial VARCHAR(60),
  fee_schedule    JSONB,
  credentials     JSONB,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_acquirer_accounts
  ON acquirer_accounts (tenant_id, provider, COALESCE(merchant_id, ''));

-- Índice de candidatos: o matching varre receivables abertos por valor/data.
CREATE INDEX idx_receivables_recon_candidates
  ON receivables (tenant_id, status, due_date, amount)
  WHERE status IN ('pending','partial');
