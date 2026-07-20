-- Migration 0081: Conciliação automática — conexões Open Finance (Pluggy).
--
-- O extrato deixa de depender de upload manual: uma conexão por banco/empresa
-- sincroniza transações direto para imported_transactions (source='bank',
-- source_kind='openfinance', dedup `of:{accountId}:{txId}` — o UNIQUE de 0071
-- absorve re-sync). A conciliação em si é o motor de 0072, inalterado.

CREATE TABLE bank_connections (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  -- Receita é por CNPJ (regra 42, mesmo racional do Mercado Livre): cada
  -- conexão pertence a UMA empresa do tenant.
  company_id     UUID          NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  provider       VARCHAR(20)   NOT NULL DEFAULT 'pluggy' CHECK (provider IN ('pluggy')),
  item_id        VARCHAR(60)   NOT NULL,  -- id do Item na Pluggy
  institution    VARCHAR(120),            -- nome do banco (connector.name)
  status         VARCHAR(15)   NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','error','disconnected')),
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, item_id)
);
CREATE INDEX idx_bank_connections_tenant ON bank_connections (tenant_id, status);

DROP TRIGGER IF EXISTS trg_bank_connections_updated_at ON bank_connections;
CREATE TRIGGER trg_bank_connections_updated_at BEFORE UPDATE ON bank_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Contas dentro da conexão (um Item pode ter corrente + poupança + cartão).
-- sync_enabled permite excluir p.ex. o cartão de crédito da conciliação.
CREATE TABLE bank_connection_accounts (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)          ON DELETE CASCADE,
  connection_id UUID         NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  account_id    VARCHAR(60)  NOT NULL,   -- id da Account na Pluggy
  type          VARCHAR(20),             -- BANK | CREDIT
  subtype       VARCHAR(30),             -- CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD
  name          VARCHAR(120),
  number_masked VARCHAR(40),
  currency      CHAR(3)      NOT NULL DEFAULT 'BRL',
  sync_enabled  BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, account_id)
);
CREATE INDEX idx_bank_connection_accounts_conn ON bank_connection_accounts (connection_id);

-- Cada sync vira um import_batch (reusa contadores inserted/duplicate e a
-- fila de conciliação): o CHECK de source_kind ganha 'openfinance'.
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_source_kind_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_source_kind_check
  CHECK (source_kind IN ('ofx','csv','xlsx','openfinance'));
