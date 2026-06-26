-- Migration 0019: NFS-e (Nota Fiscal de Serviços) support
-- Extends nfe_configs with municipal service fields, adds nfse_enabled to
-- service_contracts, creates nfse_invoices + nfse_events tables, and extends
-- contract_billings + notification_configs with NFS-e links/flags.

-- 1. Extend nfe_configs with NFS-e municipal data
ALTER TABLE nfe_configs
  ADD COLUMN IF NOT EXISTS inscricao_municipal   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS codigo_municipio_ibge VARCHAR(10) DEFAULT '3550308',
  ADD COLUMN IF NOT EXISTS aliquota_iss_padrao   DECIMAL(5,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS codigo_servico_padrao VARCHAR(10);

-- 2. Extend service_contracts with NFS-e opt-in per contract
ALTER TABLE service_contracts
  ADD COLUMN IF NOT EXISTS nfse_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS codigo_servico VARCHAR(10),
  ADD COLUMN IF NOT EXISTS aliquota_iss   DECIMAL(5,2);

-- 3. NFS-e invoice document (one per contract billing)
CREATE TABLE IF NOT EXISTS nfse_invoices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_billing_id UUID        REFERENCES contract_billings(id) ON DELETE SET NULL,
  receivable_id       UUID        REFERENCES receivables(id) ON DELETE SET NULL,
  client_id           UUID        REFERENCES clients(id) ON DELETE SET NULL,
  description         TEXT        NOT NULL,
  amount              DECIMAL(15,2) NOT NULL,
  iss_rate            DECIMAL(5,2) NOT NULL,
  iss_value           DECIMAL(15,2) NOT NULL,
  service_code        VARCHAR(10) NOT NULL,
  period_start        DATE,
  period_end          DATE,
  nfse_status         VARCHAR(30) DEFAULT NULL
    CHECK (nfse_status IS NULL OR nfse_status IN ('pending','processing','authorized','rejected')),
  nfse_number         VARCHAR(50),
  nfse_chave          VARCHAR(255),
  nfse_verify_code    VARCHAR(100),
  nfse_protocol       VARCHAR(50),
  nfse_auth_date      TIMESTAMPTZ,
  nfse_reject_reason  TEXT,
  nfse_attempts       SMALLINT    NOT NULL DEFAULT 0,
  nfse_pdf_url        TEXT,
  nfse_xml_s3_key     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. NFS-e audit trail (append-only, never delete)
CREATE TABLE IF NOT EXISTS nfse_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nfse_id     UUID        NOT NULL REFERENCES nfse_invoices(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,
  event_type  VARCHAR(30) NOT NULL,
  status_code VARCHAR(20),
  protocol    VARCHAR(50),
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Link contract_billings to the NFS-e document
ALTER TABLE contract_billings
  ADD COLUMN IF NOT EXISTS nfse_id UUID REFERENCES nfse_invoices(id) ON DELETE SET NULL;

-- 6. Notification toggles for NFS-e
ALTER TABLE notification_configs
  ADD COLUMN IF NOT EXISTS notify_nfse_authorized BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_nfse_rejected   BOOLEAN NOT NULL DEFAULT TRUE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_nfse_invoices_tenant  ON nfse_invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfse_invoices_status  ON nfse_invoices(tenant_id, nfse_status) WHERE nfse_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nfse_invoices_billing ON nfse_invoices(contract_billing_id);
CREATE INDEX IF NOT EXISTS idx_nfse_events_nfse      ON nfse_events(nfse_id);

CREATE TRIGGER update_nfse_invoices_updated_at
  BEFORE UPDATE ON nfse_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
