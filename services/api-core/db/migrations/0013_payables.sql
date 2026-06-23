-- Contas a Pagar: valores que a empresa deve a fornecedores/credores.
-- payables: registro principal (criado manualmente ou via futuro módulo de compras).
-- payable_payments: pagamentos realizados (append-only — nunca deletar).

CREATE TABLE IF NOT EXISTS payables (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_name   VARCHAR(255),
  category        VARCHAR(50)   NOT NULL DEFAULT 'other',
  description     VARCHAR(255)  NOT NULL,
  document_number VARCHAR(50),
  amount          DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  paid_amount     DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date        DATE          NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',
  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT payables_status_check CHECK (status IN ('pending','partial','paid','overdue','cancelled')),
  CONSTRAINT payables_category_check CHECK (
    category IN ('rent','utilities','payroll','supplies','services','taxes','other')
  )
);

CREATE INDEX IF NOT EXISTS idx_payables_tenant ON payables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_status ON payables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_due ON payables(tenant_id, due_date);

CREATE TRIGGER payables_updated_at
  BEFORE UPDATE ON payables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Pagamentos realizados (append-only)
CREATE TABLE IF NOT EXISTS payable_payments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payable_id      UUID          NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  payment_date    DATE          NOT NULL,
  amount          DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR(30)   NOT NULL DEFAULT 'other',
  reference       VARCHAR(100),
  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT payable_payments_method_check CHECK (
    payment_method IN ('pix','bank_transfer','cash','credit_card','debit_card','boleto','check','other')
  )
);

CREATE INDEX IF NOT EXISTS idx_payable_payments_payable ON payable_payments(payable_id);
CREATE INDEX IF NOT EXISTS idx_payable_payments_tenant ON payable_payments(tenant_id);
