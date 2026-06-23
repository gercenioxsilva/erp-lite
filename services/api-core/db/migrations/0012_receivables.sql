-- Contas a Receber: valores que clientes devem à empresa.
-- receivables: registro principal (pode ser gerado automaticamente na emissão de NF-e).
-- receivable_payments: pagamentos recebidos (append-only — nunca deletar).

CREATE TABLE IF NOT EXISTS receivables (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id     UUID          REFERENCES clients(id) ON DELETE SET NULL,
  invoice_id    UUID          REFERENCES invoices(id) ON DELETE SET NULL,
  description   VARCHAR(255)  NOT NULL,
  amount        DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  paid_amount   DECIMAL(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date      DATE          NOT NULL,
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending',
  notes         TEXT,
  created_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT receivables_status_check CHECK (status IN ('pending','partial','paid','overdue','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_receivables_tenant ON receivables(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_status ON receivables(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_due ON receivables(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_receivables_invoice ON receivables(invoice_id);

CREATE TRIGGER receivables_updated_at
  BEFORE UPDATE ON receivables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Pagamentos recebidos (append-only)
CREATE TABLE IF NOT EXISTS receivable_payments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  receivable_id   UUID          NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
  payment_date    DATE          NOT NULL,
  amount          DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  payment_method  VARCHAR(30)   NOT NULL DEFAULT 'other',
  reference       VARCHAR(100),
  notes           TEXT,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT receivable_payments_method_check CHECK (
    payment_method IN ('pix','bank_transfer','cash','credit_card','debit_card','boleto','check','other')
  )
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_receivable ON receivable_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivable_payments_tenant ON receivable_payments(tenant_id);
