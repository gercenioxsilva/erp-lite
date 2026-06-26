CREATE TABLE proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  number VARCHAR(20) NOT NULL,
  title VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  shipping DECIMAL(15,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL DEFAULT 0,
  valid_until DATE,
  notes TEXT,
  terms_text TEXT,
  public_token VARCHAR(64) UNIQUE,
  public_viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  accepted_by_name VARCHAR(255),
  accepted_by_email VARCHAR(255),
  accepted_notes TEXT,
  rejected_at TIMESTAMPTZ,
  rejected_reason TEXT,
  converted_to_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  seller_email VARCHAR(255),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT proposals_status_check CHECK (status IN ('draft','sent','viewed','accepted','rejected','expired','cancelled')),
  UNIQUE (tenant_id, number)
);

CREATE TABLE proposal_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  material_id UUID REFERENCES materials(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100),
  unit VARCHAR(20) NOT NULL DEFAULT 'UN',
  quantity DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15,2) NOT NULL CHECK (unit_price >= 0),
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  total DECIMAL(15,2) NOT NULL,
  notes TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_proposals_tenant_status ON proposals(tenant_id, status, created_at DESC);
CREATE INDEX idx_proposals_public_token ON proposals(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX idx_proposals_valid_until ON proposals(valid_until) WHERE status IN ('sent','viewed');
CREATE TRIGGER proposals_updated_at BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
