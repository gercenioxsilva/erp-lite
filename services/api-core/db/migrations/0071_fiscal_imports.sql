-- Migration 0071: Módulo Fiscal — importação multi-fonte de vendas/transações.
--
-- Molde: importador Mercado Livre (0048) — log append-only idempotente +
-- entidade de negócio + writer transacional. Aqui o LEDGER CANÔNICO é
-- imported_transactions (decisão do plano: UMA tabela com discriminador
-- source, não imported_sales+bank_transactions separadas) — a conciliação
-- (0072) é o ÚNICO escritor de reconciliation_status.
--
-- Arquivo ORIGINAL vai ao S3 (auditoria/reprocesso); import_batches guarda
-- s3_key + checksum sha256 e a contagem inserted/duplicate/error (substitui
-- o onConflictDoNothing cego dos imports antigos).

CREATE TABLE import_batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id         UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  source_kind        VARCHAR(20) NOT NULL CHECK (source_kind IN ('ofx','csv','xlsx')),
  source_template_id UUID,
  original_filename  VARCHAR(255) NOT NULL,
  s3_key             TEXT,
  checksum_sha256    CHAR(64) NOT NULL,
  byte_size          BIGINT NOT NULL DEFAULT 0,
  content_type       VARCHAR(100),
  status             VARCHAR(20) NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received','parsing','parsed','partially_failed','failed')),
  total_rows         INTEGER NOT NULL DEFAULT 0,
  inserted_rows      INTEGER NOT NULL DEFAULT 0,
  duplicate_rows     INTEGER NOT NULL DEFAULT 0,
  error_rows         INTEGER NOT NULL DEFAULT 0,
  error_message      TEXT,
  uploaded_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ
);
-- Re-upload do MESMO arquivo pela mesma empresa é idempotente.
CREATE UNIQUE INDEX uq_import_batches_checksum
  ON import_batches (tenant_id, company_id, checksum_sha256);

-- Template de mapeamento por fonte (layouts heterogêneos de adquirente:
-- Cielo/Rede/Stone/GetNet...). column_map: campo canônico -> nome da coluna.
CREATE TABLE import_source_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id        UUID REFERENCES nfe_configs(id) ON DELETE CASCADE, -- NULL = todo o tenant
  name              VARCHAR(80) NOT NULL,
  source_kind       VARCHAR(20) NOT NULL DEFAULT 'csv' CHECK (source_kind IN ('csv','xlsx')),
  provider_hint     VARCHAR(30),
  column_map        JSONB NOT NULL,
  delimiter         VARCHAR(3),
  encoding          VARCHAR(10) NOT NULL DEFAULT 'utf8' CHECK (encoding IN ('utf8','win1252')),
  date_format       VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY',
  decimal_separator CHAR(1)  NOT NULL DEFAULT ',',
  has_header        BOOLEAN  NOT NULL DEFAULT true,
  skip_rows         SMALLINT NOT NULL DEFAULT 0,
  dedup_strategy    VARCHAR(12) NOT NULL DEFAULT 'auto' CHECK (dedup_strategy IN ('auto','nsu','line_hash')),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- LEDGER CANÔNICO. Os 14 campos exigidos são todos nullable (fonte pode não
-- trazer); raw jsonb preserva TUDO que o mapa não mapeou — nada se perde.
CREATE TABLE imported_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  batch_id              UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source                VARCHAR(10) NOT NULL CHECK (source IN ('bank','acquirer','file')),
  source_kind           VARCHAR(20) NOT NULL,
  dedup_key             VARCHAR(200) NOT NULL,
  -- Campos sem-perda (todos nullable):
  occurred_at           TIMESTAMPTZ,          -- data+hora
  nsu                   VARCHAR(40),
  authorization_code    VARCHAR(40),
  acquirer              VARCHAR(40),
  card_brand            VARCHAR(30),
  customer_name         VARCHAR(255),
  customer_document     VARCHAR(14),          -- CPF/CNPJ (dígitos)
  gross_amount          NUMERIC(15,2),
  fee_amount            NUMERIC(15,2),
  net_amount            NUMERIC(15,2),
  installments          SMALLINT,
  payment_method        VARCHAR(30),
  establishment         VARCHAR(120),
  terminal_serial       VARCHAR(60),
  -- OFX:
  bank_account_ref      VARCHAR(60),          -- BANKID/ACCTID
  fitid                 VARCHAR(120),
  memo                  TEXT,
  trn_type              VARCHAR(20),
  amount                NUMERIC(15,2),        -- sinalizado (+crédito/−débito)
  raw                   JSONB NOT NULL,       -- linha original completa
  -- Escrito EXCLUSIVAMENTE pelo motor de conciliação (0072):
  reconciliation_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (reconciliation_status IN ('pending','matched','partially_matched','ignored','unmatched')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_imported_tx_dedup ON imported_transactions (tenant_id, dedup_key);
CREATE INDEX idx_imported_tx_recon  ON imported_transactions (tenant_id, company_id, reconciliation_status);
CREATE INDEX idx_imported_tx_batch  ON imported_transactions (batch_id);
CREATE INDEX idx_imported_tx_nsu    ON imported_transactions (tenant_id, nsu) WHERE nsu IS NOT NULL;
