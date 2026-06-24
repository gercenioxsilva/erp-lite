-- ── Billing Module: Tenant Banking Data + Boletos ────────────────────────────
-- 0014: Extend tenants with banking info + add boletos & boleto_events tables

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend tenants table with banking configuration
--    PostgreSQL requires one ADD COLUMN clause per column (no parentheses list)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN bank_code              VARCHAR(10),
  ADD COLUMN agency                 VARCHAR(10),
  ADD COLUMN account                VARCHAR(20),
  ADD COLUMN account_digit          VARCHAR(5),
  ADD COLUMN billing_provider       VARCHAR(30)  NOT NULL DEFAULT 'brcode',
  ADD COLUMN billing_days_to_expire INT          NOT NULL DEFAULT 30,
  ADD COLUMN billing_webhook_token  TEXT,
  ADD COLUMN banking_updated_at     TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create boletos table (one per receivable)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boletos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  receivable_id UUID        NOT NULL UNIQUE REFERENCES receivables(id) ON DELETE CASCADE,

  -- External boleto identifier from bank
  boleto_id     VARCHAR(100),
  brcode        TEXT,                   -- PIX Copia e Cola (EMV QR) — can be > 100 chars
  pix_qr_code   TEXT,                   -- URL / SVG do QR Code dinâmico
  nosso_numero  VARCHAR(50),            -- Número sequencial atribuído pelo banco

  -- Banking data snapshot (captured at emission time)
  banco_code    VARCHAR(10),
  agencia       VARCHAR(10),
  conta         VARCHAR(20),
  digito        VARCHAR(5),

  -- Status workflow: pending → sent | error → expired | paid
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
  issued_at     TIMESTAMPTZ,
  expires_at    DATE,
  paid_at       TIMESTAMPTZ,
  error_reason  TEXT,

  -- Download links
  boleto_url    TEXT,
  pdf_s3_key    TEXT,

  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_boletos_updated_at
  BEFORE UPDATE ON boletos
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

CREATE INDEX idx_boletos_tenant_id     ON boletos(tenant_id);
CREATE INDEX idx_boletos_receivable_id ON boletos(receivable_id);
CREATE INDEX idx_boletos_status        ON boletos(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Create boleto_events table (audit trail, append-only — never delete)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boleto_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  boleto_id   UUID        NOT NULL REFERENCES boletos(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  event_type  VARCHAR(30) NOT NULL,    -- generated | paid | expired | cancelled | error
  status_code VARCHAR(50),             -- Código de resposta do banco
  response    JSONB,                   -- Payload completo da resposta do banco
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_boleto_events_boleto_id  ON boleto_events(boleto_id);
CREATE INDEX idx_boleto_events_tenant_id  ON boleto_events(tenant_id);
CREATE INDEX idx_boleto_events_created_at ON boleto_events(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Extend receivables with boleto_id back-reference (nullable 1:1)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE receivables
  ADD COLUMN boleto_id UUID REFERENCES boletos(id) ON DELETE SET NULL;

CREATE INDEX idx_receivables_boleto_id ON receivables(boleto_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Extend notification_configs with boleto notification toggle
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_configs
  ADD COLUMN notify_boleto_generated BOOLEAN NOT NULL DEFAULT false;
