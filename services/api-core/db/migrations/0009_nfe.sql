-- NF-e configuration per tenant (emitter data for SEFAZ + Focus NF-e settings)
CREATE TABLE IF NOT EXISTS nfe_configs (
  tenant_id            UUID          PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  -- Emitter (the tenant company that issues the NF-e)
  cnpj                 VARCHAR(14)   NOT NULL,
  razao_social         VARCHAR(255)  NOT NULL,
  nome_fantasia        VARCHAR(255),
  regime_tributario    SMALLINT      NOT NULL DEFAULT 1
                       CHECK (regime_tributario IN (1, 2, 3)),  -- 1=SN 2=LP 3=LR
  -- Address
  logradouro           VARCHAR(255)  NOT NULL,
  numero               VARCHAR(60)   NOT NULL,
  complemento          VARCHAR(60),
  bairro               VARCHAR(60)   NOT NULL,
  municipio            VARCHAR(60)   NOT NULL DEFAULT 'SAO PAULO',
  uf                   CHAR(2)       NOT NULL DEFAULT 'SP',
  cep                  VARCHAR(8)    NOT NULL,
  telefone             VARCHAR(20),
  email                VARCHAR(255),
  -- Defaults for NF-e generation
  cfop_padrao          VARCHAR(10)   NOT NULL DEFAULT '5102',
  cfop_interestadual   VARCHAR(10)   NOT NULL DEFAULT '6102',
  natureza_operacao    VARCHAR(60)   NOT NULL DEFAULT 'Venda de mercadoria',
  -- Focus NF-e settings (certificate is uploaded directly to Focus NF-e portal)
  focus_ambiente       SMALLINT      NOT NULL DEFAULT 2
                       CHECK (focus_ambiente IN (1, 2)),  -- 1=produção 2=homologação
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER nfe_configs_updated_at
  BEFORE UPDATE ON nfe_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- NF-e status tracking fields on invoices
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS nfe_status       VARCHAR(30) DEFAULT NULL
    CHECK (nfe_status IS NULL OR nfe_status IN (
      'pending','processing','authorized','rejected',
      'cancellation_pending','cancelled_sefaz'
    )),
  ADD COLUMN IF NOT EXISTS nfe_chave        CHAR(44)    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nfe_protocol     VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nfe_auth_date    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nfe_reject_reason TEXT       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nfe_attempts     SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nfe_xml_s3_key   TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS nfe_danfe_url    TEXT        DEFAULT NULL;

-- Audit log: every NF-e event (emission, cancellation, correction letter)
CREATE TABLE IF NOT EXISTS nfe_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tenant_id    UUID         NOT NULL,
  event_type   VARCHAR(30)  NOT NULL,  -- emission | cancellation | correction
  status_code  VARCHAR(10),            -- SEFAZ cStat (e.g. '100' = authorized)
  protocol     VARCHAR(20),
  payload      JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_nfe_status
  ON invoices(tenant_id, nfe_status)
  WHERE nfe_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nfe_events_invoice ON nfe_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_nfe_events_tenant  ON nfe_events(tenant_id, created_at DESC);
