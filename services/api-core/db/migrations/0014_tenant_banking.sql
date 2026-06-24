-- ── Billing Module: Tenant Banking Data + Boletos ────────────────────────────

-- 0014: Extend tenants with banking info + add boletos & boleto_events tables

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend tenants table with banking configuration
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants ADD COLUMN (
  bank_code VARCHAR(3),                    -- e.g., '341' (Itaú), '033' (Santander), '001' (BB)
  agency VARCHAR(10),                      -- e.g., '1234'
  account VARCHAR(20),                     -- e.g., '16102-5'
  account_digit VARCHAR(2),                -- Dígito verificador
  billing_provider VARCHAR(30) DEFAULT 'brcode', -- brcode | itau | santander | ...
  billing_days_to_expire INT DEFAULT 30,   -- Dias até expiração do boleto
  billing_webhook_token TEXT,              -- Token para confirmações do banco
  banking_updated_at TIMESTAMPTZ           -- Auditoria de quando foi atualizado
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create boletos table (one per receivable)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boletos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receivable_id UUID NOT NULL UNIQUE REFERENCES receivables(id) ON DELETE CASCADE,

  -- Identificação do boleto gerado
  boleto_id VARCHAR(100),            -- ID do boleto no sistema externo
  brcode VARCHAR(100),               -- Chave dinâmica (QR Code Pix copy-paste)
  pix_qr_code TEXT,                  -- SVG/URL do QR code dinâmico
  nosso_numero VARCHAR(20),          -- Número sequencial do banco

  -- Dados bancários (snapshot)
  banco_code VARCHAR(3),
  agencia VARCHAR(10),
  conta VARCHAR(20),
  digito VARCHAR(2),

  -- Status workflow
  status VARCHAR(20) DEFAULT 'draft',  -- draft | pending | sent | paid | expired | cancelled
  issued_at TIMESTAMPTZ,             -- Quando foi gerado
  expires_at DATE,                   -- Vencimento do boleto
  paid_at TIMESTAMPTZ,               -- Quando foi pago

  -- URLs de acesso
  boleto_url TEXT,                   -- Link público para pagamento / download PDF
  pdf_s3_key TEXT,                   -- Chave do PDF no S3

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, nosso_numero)  -- Não pode haver dois boletos com mesmo nosso_numero por tenant
);

CREATE TRIGGER update_boletos_updated_at
BEFORE UPDATE ON boletos FOR EACH ROW
EXECUTE PROCEDURE update_updated_at();

CREATE INDEX idx_boletos_tenant_id ON boletos(tenant_id);
CREATE INDEX idx_boletos_receivable_id ON boletos(receivable_id);
CREATE INDEX idx_boletos_status ON boletos(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Create boleto_events table (audit trail, append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE boleto_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boleto_id UUID NOT NULL REFERENCES boletos(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),

  event_type VARCHAR(30),            -- generated | sent | confirmed_paid | cancelled | error
  status_code VARCHAR(20),           -- Código de resposta do banco
  response JSONB,                    -- Resposta completa do serviço

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_boleto_events_boleto_id ON boleto_events(boleto_id);
CREATE INDEX idx_boleto_events_tenant_id ON boleto_events(tenant_id);
CREATE INDEX idx_boleto_events_created_at ON boleto_events(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Extend receivables table with boleto_id
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE receivables ADD COLUMN boleto_id UUID REFERENCES boletos(id);

CREATE INDEX idx_receivables_boleto_id ON receivables(boleto_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Extend notification_configs with boleto notifications toggle
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_configs ADD COLUMN notify_boleto_generated BOOLEAN DEFAULT true;
