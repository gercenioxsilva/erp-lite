-- Saldo materializado de estoque por (centro de custo, material).
-- cost_center_stock: snapshot do saldo atual — atualizado a cada movimentação.
-- cost_center_movements: razão append-only de todas as entradas e saídas.

-- ENUMs
DO $$ BEGIN
  CREATE TYPE cc_movement_direction AS ENUM ('in', 'out');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE cc_movement_source AS ENUM ('manual_entry', 'adjustment', 'payable', 'order', 'invoice');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Saldo por (centro de custo × material)
CREATE TABLE IF NOT EXISTS cost_center_stock (
  tenant_id      UUID          NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  cost_center_id UUID          NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  material_id    UUID          NOT NULL REFERENCES materials(id),
  quantity       NUMERIC(14,4) NOT NULL DEFAULT 0,
  avg_unit_cost  NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cost_center_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_stock_tenant   ON cost_center_stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cc_stock_material ON cost_center_stock(material_id);

-- Movimentações (append-only — nunca deletar)
CREATE TABLE IF NOT EXISTS cost_center_movements (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID                  NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  cost_center_id  UUID                  NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  material_id     UUID                  NOT NULL REFERENCES materials(id),
  direction       cc_movement_direction NOT NULL,
  quantity        NUMERIC(14,4)         NOT NULL CHECK (quantity > 0),
  unit_cost       NUMERIC(14,2),
  total_cost      NUMERIC(14,2),
  balance_after   NUMERIC(14,4)         NOT NULL,
  source          cc_movement_source    NOT NULL,
  source_id       UUID,
  note            TEXT,
  idempotency_key VARCHAR(160)          NOT NULL,
  created_by      UUID,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cc_mov_cc       ON cost_center_movements(cost_center_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_mov_material ON cost_center_movements(cost_center_id, material_id);
CREATE INDEX IF NOT EXISTS idx_cc_mov_source   ON cost_center_movements(source, source_id);
