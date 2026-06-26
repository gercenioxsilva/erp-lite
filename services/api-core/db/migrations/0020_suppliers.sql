-- Tabela de fornecedores por tenant
CREATE TABLE suppliers (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  person_type     VARCHAR(2)  NOT NULL DEFAULT 'PJ',
  company_name    VARCHAR(255),
  trade_name      VARCHAR(255),
  cnpj            VARCHAR(14),
  full_name       VARCHAR(255),
  cpf             VARCHAR(11),
  email           VARCHAR(255),
  phone           VARCHAR(30),
  zip_code        VARCHAR(8),
  street          VARCHAR(255),
  street_number   VARCHAR(20),
  complement      VARCHAR(100),
  neighborhood    VARCHAR(100),
  city            VARCHAR(100),
  state           CHAR(2),
  bank_code       VARCHAR(10),
  agency          VARCHAR(20),
  account         VARCHAR(20),
  account_digit   VARCHAR(5),
  pix_key         VARCHAR(255),
  category        VARCHAR(50)  NOT NULL DEFAULT 'services',
  notes           TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_tenant   ON suppliers(tenant_id);
CREATE INDEX idx_suppliers_active   ON suppliers(tenant_id, is_active);
CREATE INDEX idx_suppliers_cnpj     ON suppliers(tenant_id, cnpj) WHERE cnpj IS NOT NULL;

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Adiciona FK opcional em payables (retrocompatível — supplier_name continua como fallback)
ALTER TABLE payables
  ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX idx_payables_supplier ON payables(supplier_id) WHERE supplier_id IS NOT NULL;
