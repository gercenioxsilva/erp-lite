-- Orders (Pedidos de Venda)
-- Supports the full sale lifecycle: draft → confirmed → invoiced → delivered | cancelled
-- Inventory is deducted atomically when status transitions to 'confirmed'.
-- order_items snapshots material name/sku/unit at creation time (immutable business record).

CREATE TABLE IF NOT EXISTS orders (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  client_id   UUID          NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  number      VARCHAR(20)   NOT NULL,
  status      VARCHAR(20)   NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'confirmed', 'invoiced', 'delivered', 'cancelled')),
  notes       TEXT,
  subtotal    DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount    DECIMAL(15,2) NOT NULL DEFAULT 0,
  shipping    DECIMAL(15,2) NOT NULL DEFAULT 0,
  total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, number)
);

-- Snapshot of materials at time of order (price/name may change later)
CREATE TABLE IF NOT EXISTS order_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  material_id UUID          REFERENCES materials(id) ON DELETE RESTRICT,
  name        VARCHAR(255)  NOT NULL,
  sku         VARCHAR(100),
  unit        VARCHAR(10)   NOT NULL DEFAULT 'UN',
  quantity    DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit_price  DECIMAL(15,2) NOT NULL CHECK (unit_price >= 0),
  total       DECIMAL(15,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant   ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_client   ON orders(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items     ON order_items(order_id);

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
