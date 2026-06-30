-- Kits / Combos: um material do tipo 'kit' agrupa vários componentes (peças).
-- Ex.: "Manutenção 4.000h CPM 15" reúne filtros, óleo e mão de obra.
-- A baixa de estoque de um kit fechado é feita expandindo estes componentes.

CREATE TABLE IF NOT EXISTS material_components (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  kit_id       UUID          NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  component_id UUID          NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity     NUMERIC(15,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order   INTEGER       NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (kit_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_material_components_kit    ON material_components(kit_id);
CREATE INDEX IF NOT EXISTS idx_material_components_tenant ON material_components(tenant_id);
