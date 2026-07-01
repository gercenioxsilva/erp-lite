-- P2 — Pedidos de Compra (Purchase Orders)
-- Espelho da estrutura de pedidos de venda (orders), voltado para o lado da compra.
-- purchase_orders: cabeçalho do pedido de compra por fornecedor.
-- purchase_order_items: linhas de produto/serviço do pedido.
-- Estado: draft → approved → received → cancelled
--   draft    — rascunho, editável
--   approved — aprovado pelo responsável, enviado ao fornecedor
--   received — mercadoria/serviço recebido (total ou parcial, registrado via NF-e entrada)
--   cancelled — cancelado antes do recebimento

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id     UUID          REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name   VARCHAR(255),
  number          VARCHAR(20)   NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft',
  expected_date   DATE,
  subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  shipping        NUMERIC(15,2) NOT NULL DEFAULT 0,
  total           NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  cost_center_id  UUID          REFERENCES cost_centers(id) ON DELETE SET NULL,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  approved_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, number),
  CONSTRAINT chk_po_status CHECK (status IN ('draft', 'approved', 'received', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_po_tenant    ON purchase_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_supplier  ON purchase_orders(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_status    ON purchase_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_po_cc        ON purchase_orders(cost_center_id) WHERE cost_center_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id        UUID          REFERENCES materials(id) ON DELETE SET NULL,
  name               VARCHAR(255)  NOT NULL,
  sku                VARCHAR(100),
  unit               VARCHAR(20)   NOT NULL DEFAULT 'UN',
  quantity           NUMERIC(15,3) NOT NULL,
  unit_price         NUMERIC(15,2) NOT NULL,
  total              NUMERIC(15,2) NOT NULL,
  notes              TEXT,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(purchase_order_id);
