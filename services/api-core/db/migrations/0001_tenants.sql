-- Tenants are the SaaS customers (companies) that use ERP Lite.
-- This is the root table of the multi-tenant model: every other
-- ERP table carries a tenant_id FK pointing here.

CREATE TABLE IF NOT EXISTS tenants (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Company identification
  company_name              VARCHAR(255) NOT NULL,
  trade_name                VARCHAR(255),
  tax_id                    VARCHAR(50)  NOT NULL,
  tax_id_type               VARCHAR(10)  NOT NULL DEFAULT 'CNPJ'
                              CHECK (tax_id_type IN ('CNPJ', 'EIN', 'VAT', 'OTHER')),

  -- Address
  street                    VARCHAR(255),
  street_number             VARCHAR(20),
  complement                VARCHAR(100),
  neighborhood              VARCHAR(100),
  city                      VARCHAR(100),
  state                     VARCHAR(100),
  postal_code               VARCHAR(20),
  country                   CHAR(2)      NOT NULL DEFAULT 'BR',

  -- Main contact
  phone                     VARCHAR(30),
  website                   VARCHAR(255),

  -- Purchasing contact (compras)
  purchasing_contact_name   VARCHAR(255),
  purchasing_contact_phone  VARCHAR(30),
  purchasing_contact_email  VARCHAR(255),

  -- Maintenance / IT contact (manutenção)
  maintenance_contact_name  VARCHAR(255),
  maintenance_contact_phone VARCHAR(30),
  maintenance_contact_email VARCHAR(255),

  -- Fiscal / tax contact (fiscal)
  fiscal_contact_name       VARCHAR(255),
  fiscal_contact_phone      VARCHAR(30),
  fiscal_contact_email      VARCHAR(255),

  -- SaaS lifecycle
  status                    VARCHAR(20)  NOT NULL DEFAULT 'trial'
                              CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  plan                      VARCHAR(30)  NOT NULL DEFAULT 'starter'
                              CHECK (plan IN ('starter', 'professional', 'enterprise')),
  trial_ends_at             TIMESTAMPTZ,

  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- tax_id scoped to type so a CNPJ and EIN with same digits can coexist
  UNIQUE (tax_id, tax_id_type)
);

CREATE INDEX IF NOT EXISTS idx_tenants_tax_id      ON tenants(tax_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status      ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_company     ON tenants(company_name);
CREATE INDEX IF NOT EXISTS idx_tenants_country     ON tenants(country);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
