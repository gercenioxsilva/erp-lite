-- Cadastro de vendedores e motor de comissionamento.
-- sellers: vendedores do tenant — desacoplado de users (login via user_id é opcional,
-- pois nem todo vendedor precisa ter acesso ao sistema, ex.: representante externo).
-- commission_entries: uma linha por NF-e autorizada com vendedor atribuído.
-- Comissão é lançada quando a NF-e é autorizada (nfeResultsWorker) e cancelada
-- quando a NF-e é cancelada (POST /v1/invoices/:id/cancel) — nunca deletada (regra 8).

CREATE TABLE IF NOT EXISTS sellers (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                 UUID         REFERENCES users(id) ON DELETE SET NULL,
  name                    VARCHAR(255) NOT NULL,
  email                   VARCHAR(255),
  phone                   VARCHAR(20),
  document                VARCHAR(20),
  default_commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_base         VARCHAR(20)  NOT NULL DEFAULT 'subtotal',
  is_active               BOOLEAN      NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sellers_commission_base CHECK (commission_base IN ('subtotal', 'total'))
);

CREATE INDEX IF NOT EXISTS idx_sellers_tenant ON sellers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sellers_active ON sellers(tenant_id, is_active);

DROP TRIGGER IF EXISTS trg_sellers_updated_at ON sellers;
CREATE TRIGGER trg_sellers_updated_at
  BEFORE UPDATE ON sellers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Atribuição opcional de vendedor (nullable — não quebra pedidos/notas existentes)
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES sellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_seller   ON orders(seller_id)   WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_seller ON invoices(seller_id) WHERE seller_id IS NOT NULL;

-- Ledger de comissão: uma linha por NF-e autorizada com vendedor atribuído.
CREATE TABLE IF NOT EXISTS commission_entries (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  seller_id          UUID          NOT NULL REFERENCES sellers(id)  ON DELETE CASCADE,
  invoice_id         UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id           UUID          REFERENCES orders(id) ON DELETE SET NULL,
  base_amount        NUMERIC(15,2) NOT NULL,
  rate               NUMERIC(5,2)  NOT NULL,
  commission_amount  NUMERIC(15,2) NOT NULL,
  status             VARCHAR(20)   NOT NULL DEFAULT 'accrued',
  idempotency_key    VARCHAR(160)  NOT NULL,
  cancelled_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT chk_commission_status CHECK (status IN ('accrued', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_commission_seller  ON commission_entries(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_tenant  ON commission_entries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_invoice ON commission_entries(invoice_id);
