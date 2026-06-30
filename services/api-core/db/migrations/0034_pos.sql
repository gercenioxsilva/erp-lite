-- 0029_pos.sql — PDV: terminais, sessoes, vendas, NFC-e, source pos_sale

-- ───── ENUMs ─────
DO $$ BEGIN CREATE TYPE pos_session_status AS ENUM ('open','closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE pos_sale_status AS ENUM ('open','finalized','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE pos_payment_method AS ENUM ('cash','debit','credit','pix','voucher','store_credit');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN CREATE TYPE pos_cash_move_type AS ENUM ('opening','suprimento','sangria','sale_cash','closing');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ───── cc_movement_source: add pos_sale ─────
DO $$ BEGIN ALTER TYPE cc_movement_source ADD VALUE IF NOT EXISTS 'pos_sale';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ───── materials: add fiscal fields ─────
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS cfop      VARCHAR(4),
  ADD COLUMN IF NOT EXISTS cst_csosn VARCHAR(4),
  ADD COLUMN IF NOT EXISTS gtin      VARCHAR(14);

-- ───── invoices: NFC-e (model 65) ─────
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS model             SMALLINT NOT NULL DEFAULT 55,
  ADD COLUMN IF NOT EXISTS nfce_qrcode       TEXT,
  ADD COLUMN IF NOT EXISTS nfce_url_consulta TEXT;

-- ───── pos_terminals ─────
CREATE TABLE IF NOT EXISTS pos_terminals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code           VARCHAR(20)  NOT NULL,
  name           VARCHAR(255) NOT NULL,
  cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  nfce_series    INTEGER NOT NULL DEFAULT 1,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);
CREATE TRIGGER pos_terminals_updated_at
  BEFORE UPDATE ON pos_terminals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ───── pos_sessions ─────
CREATE TABLE IF NOT EXISTS pos_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id      UUID NOT NULL REFERENCES pos_terminals(id),
  operator_id      UUID NOT NULL REFERENCES users(id),
  status           pos_session_status NOT NULL DEFAULT 'open',
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  closed_at        TIMESTAMPTZ,
  closing_counted  NUMERIC(14,2),
  closing_expected NUMERIC(14,2),
  difference       NUMERIC(14,2),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_session_open ON pos_sessions(terminal_id) WHERE status = 'open';

-- ───── pos_cash_movements ─────
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE CASCADE,
  type        pos_cash_move_type NOT NULL,
  amount      NUMERIC(14,2) NOT NULL,
  reason      TEXT,
  sale_id     UUID,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_cash_session ON pos_cash_movements(session_id, created_at);

-- ───── pos_sales ─────
CREATE TABLE IF NOT EXISTS pos_sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id),
  terminal_id     UUID NOT NULL REFERENCES pos_terminals(id),
  operator_id     UUID NOT NULL REFERENCES users(id),
  cost_center_id  UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  customer_doc    VARCHAR(14),
  customer_name   VARCHAR(255),
  status          pos_sale_status NOT NULL DEFAULT 'open',
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL DEFAULT 0,
  invoice_id      UUID REFERENCES invoices(id),
  idempotency_key VARCHAR(160),
  finalized_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, idempotency_key)
);
CREATE TRIGGER pos_sales_updated_at
  BEFORE UPDATE ON pos_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX IF NOT EXISTS idx_pos_sales_session ON pos_sales(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_sales_status  ON pos_sales(tenant_id, status);

-- ───── pos_sale_items ─────
CREATE TABLE IF NOT EXISTS pos_sale_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id         UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES materials(id),
  description     VARCHAR(255) NOT NULL,
  quantity        NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  unit_price      NUMERIC(14,2) NOT NULL,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total           NUMERIC(14,2) NOT NULL,
  ncm             VARCHAR(8),
  cfop            VARCHAR(4),
  cst_csosn       VARCHAR(4),
  unit            VARCHAR(6),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_sale_items_sale ON pos_sale_items(sale_id);

-- ───── pos_sale_payments ─────
CREATE TABLE IF NOT EXISTS pos_sale_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id            UUID NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  method             pos_payment_method NOT NULL,
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  installments       INTEGER NOT NULL DEFAULT 1,
  authorization_code VARCHAR(60),
  change_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_sale_payments_sale ON pos_sale_payments(sale_id);
