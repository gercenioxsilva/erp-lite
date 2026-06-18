-- inventory: current stock level per material per tenant.
-- One row per material (future: one row per material+warehouse).
-- quantity is the ground truth; inventory_movements is the audit trail.

CREATE TABLE IF NOT EXISTS inventory (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  material_id UUID          NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,

  quantity    DECIMAL(15,3) NOT NULL DEFAULT 0,
  min_qty     DECIMAL(15,3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  max_qty     DECIMAL(15,3)           CHECK (max_qty IS NULL OR max_qty >= 0),

  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_tenant   ON inventory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_material ON inventory(material_id);
CREATE INDEX IF NOT EXISTS idx_inventory_low      ON inventory(tenant_id, material_id)
  WHERE quantity <= min_qty;

-- inventory_movements: immutable audit log of every stock change.
-- quantity: positive = stock added, negative = stock removed.
-- movement_type reference:
--   in         → purchase / production receipt
--   out        → sale / consumption
--   adjustment → manual correction (cycle count)
--   return     → customer/supplier return
--   transfer   → movement between warehouses (future)

CREATE TABLE IF NOT EXISTS inventory_movements (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  material_id     UUID          NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,

  movement_type   VARCHAR(20)   NOT NULL
                    CHECK (movement_type IN ('in', 'out', 'adjustment', 'return', 'transfer')),
  quantity        DECIMAL(15,3) NOT NULL,
  quantity_before DECIMAL(15,3) NOT NULL,
  quantity_after  DECIMAL(15,3) NOT NULL,

  reason          TEXT,
  reference_id    UUID,
  reference_type  VARCHAR(50),

  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_tenant     ON inventory_movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_material   ON inventory_movements(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_reference  ON inventory_movements(reference_id, reference_type)
  WHERE reference_id IS NOT NULL;
