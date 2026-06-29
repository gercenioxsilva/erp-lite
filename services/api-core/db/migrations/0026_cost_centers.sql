-- Centro de Custo: agrupa despesas e receitas por departamento, projeto ou área.
-- cost_centers: cadastro de centros de custo por tenant.
-- Adiciona cost_center_id (nullable) em payables, orders, invoices e receivables.

CREATE TABLE IF NOT EXISTS cost_centers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code          VARCHAR(20)  NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  allow_negative BOOLEAN     NOT NULL DEFAULT false,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cost_centers_tenant ON cost_centers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_active ON cost_centers(tenant_id, is_active);

DROP TRIGGER IF EXISTS trg_cost_centers_updated_at ON cost_centers;
CREATE TRIGGER trg_cost_centers_updated_at
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Adiciona FK nullable de centro de custo nas tabelas transacionais
ALTER TABLE payables    ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE orders      ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE invoices    ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE receivables ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL;

-- Índices parciais — só indexa linhas que de fato têm centro de custo vinculado
CREATE INDEX IF NOT EXISTS idx_payables_cc    ON payables(cost_center_id)    WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cc      ON orders(cost_center_id)      WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_cc    ON invoices(cost_center_id)    WHERE cost_center_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receivables_cc ON receivables(cost_center_id) WHERE cost_center_id IS NOT NULL;
