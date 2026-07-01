-- P1 — NF-e de Entrada (Supplier Invoices / Nota Fiscal de Entrada)
-- Registro das notas fiscais recebidas de fornecedores.
-- Estado: draft → confirmed → cancelled | divergence
--   draft      — dados inseridos manualmente ou importados via chave de acesso, ainda não confirmados
--   confirmed  — recebimento confirmado: gera payable + movimento de estoque (entrada)
--   cancelled  — nota cancelada/rejeitada (devolvida ou com divergência insanável)
--   divergence — nota com itens divergentes do pedido de compra (status informativo, requer ação)

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id         UUID          REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name       VARCHAR(255),
  purchase_order_id   UUID          REFERENCES purchase_orders(id) ON DELETE SET NULL,
  -- Dados da NF-e
  nfe_key             VARCHAR(44)   UNIQUE,
  nfe_number          VARCHAR(20),
  nfe_series          VARCHAR(5)    DEFAULT '1',
  issue_date          DATE,
  -- Totais
  subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_total           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total               NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- Financeiro
  due_date            DATE,
  payable_id          UUID          REFERENCES payables(id) ON DELETE SET NULL,
  -- Estado
  status              VARCHAR(20)   NOT NULL DEFAULT 'draft',
  notes               TEXT,
  -- Centro de Custo
  cost_center_id      UUID          REFERENCES cost_centers(id) ON DELETE SET NULL,
  -- Auditoria
  created_by          UUID          REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_si_status CHECK (status IN ('draft', 'confirmed', 'cancelled', 'divergence'))
);

CREATE INDEX IF NOT EXISTS idx_si_tenant      ON supplier_invoices(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_supplier    ON supplier_invoices(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_po          ON supplier_invoices(purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_status      ON supplier_invoices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_si_nfe_key     ON supplier_invoices(nfe_key) WHERE nfe_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoices_updated_at
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS supplier_invoice_items (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id  UUID          NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  material_id          UUID          REFERENCES materials(id) ON DELETE SET NULL,
  name                 VARCHAR(255)  NOT NULL,
  ncm_code             VARCHAR(10),
  cfop                 VARCHAR(5),
  unit                 VARCHAR(20)   NOT NULL DEFAULT 'UN',
  quantity             NUMERIC(15,3) NOT NULL,
  unit_price           NUMERIC(15,2) NOT NULL,
  total                NUMERIC(15,2) NOT NULL,
  -- Impostos na entrada (para crédito fiscal)
  icms_rate            NUMERIC(5,2),
  icms_value           NUMERIC(15,2),
  ipi_rate             NUMERIC(5,2),
  ipi_value            NUMERIC(15,2),
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sii_invoice ON supplier_invoice_items(supplier_invoice_id);
