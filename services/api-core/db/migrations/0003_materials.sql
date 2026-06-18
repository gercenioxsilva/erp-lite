-- Materials: products and services available for sale/purchase.
-- type = 'product'      → physical item, tracks stock (tracks_inventory = true)
-- type = 'service'      → intangible, no stock (tracks_inventory = false)
-- type = 'raw_material' → used in production, tracks stock
-- type = 'asset'        → fixed asset, no stock tracking

CREATE TABLE IF NOT EXISTS materials (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

  -- Identification
  sku         VARCHAR(100)  NOT NULL,
  name        VARCHAR(255)  NOT NULL,
  description TEXT,

  -- Classification
  type        VARCHAR(20)   NOT NULL DEFAULT 'product'
                CHECK (type IN ('product', 'service', 'raw_material', 'asset')),
  category    VARCHAR(100),
  brand       VARCHAR(100),
  unit        VARCHAR(20)   NOT NULL DEFAULT 'UN',

  -- Pricing
  sale_price  DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  cost_price  DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),

  -- Fiscal (NCM = Brazil, HS Code = international customs)
  ncm_code    VARCHAR(10),
  tax_group   VARCHAR(50),

  -- Physical (products only)
  weight_kg   DECIMAL(10,3) CHECK (weight_kg IS NULL OR weight_kg >= 0),

  -- Behaviour flags
  is_active         BOOLEAN NOT NULL DEFAULT true,
  tracks_inventory  BOOLEAN NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- sku is unique within a tenant
  UNIQUE (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_materials_tenant        ON materials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_materials_type          ON materials(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_materials_category      ON materials(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_materials_active        ON materials(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_materials_name          ON materials(tenant_id, name);

CREATE TRIGGER materials_updated_at
  BEFORE UPDATE ON materials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
