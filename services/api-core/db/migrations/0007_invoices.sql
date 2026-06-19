-- Invoices / Notas Fiscais
-- Can be generated from an order (order_id) or created standalone.
-- Status: draft → issued → cancelled
-- When issued: number and issue_date are set (NF-e number is sequential per tenant/serie).

CREATE TABLE IF NOT EXISTS invoices (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id    UUID          REFERENCES orders(id) ON DELETE SET NULL,
  client_id   UUID          NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  number      VARCHAR(20)   NOT NULL DEFAULT '',
  serie       VARCHAR(10)   NOT NULL DEFAULT '1',
  status      VARCHAR(20)   NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'issued', 'cancelled')),
  issue_date  DATE,
  subtotal    DECIMAL(15,2) NOT NULL DEFAULT 0,
  tax_total   DECIMAL(15,2) NOT NULL DEFAULT 0,
  total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  xml_url     TEXT,
  pdf_url     TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  material_id UUID          REFERENCES materials(id) ON DELETE RESTRICT,
  name        VARCHAR(255)  NOT NULL,
  ncm_code    VARCHAR(20),
  cfop        VARCHAR(10),
  quantity    DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit_price  DECIMAL(15,2) NOT NULL CHECK (unit_price >= 0),
  total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant   ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order    ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client   ON invoices(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_created  ON invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items     ON invoice_items(invoice_id);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
