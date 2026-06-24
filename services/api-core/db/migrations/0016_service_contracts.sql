-- Migration 0016: Service Contracts + Contract Billings
-- Contratos de manutenção/serviço com geração automática de contas a receber

CREATE TABLE service_contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  material_id       UUID REFERENCES materials(id) ON DELETE SET NULL,
  contract_number   VARCHAR(20) NOT NULL,
  description       TEXT NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE,
  billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  billing_day       SMALLINT NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  amount            DECIMAL(15,2) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active',
  notes             TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, contract_number)
);

CREATE TABLE contract_billings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contract_id   UUID NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  receivable_id UUID REFERENCES receivables(id) ON DELETE SET NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  amount        DECIMAL(15,2) NOT NULL,
  due_date      DATE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_contracts_tenant  ON service_contracts(tenant_id);
CREATE INDEX idx_service_contracts_client  ON service_contracts(client_id);
CREATE INDEX idx_service_contracts_status  ON service_contracts(tenant_id, status, billing_day);
CREATE INDEX idx_contract_billings_contract ON contract_billings(contract_id);
CREATE INDEX idx_contract_billings_due     ON contract_billings(due_date);

CREATE TRIGGER update_service_contracts_updated_at
  BEFORE UPDATE ON service_contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_contract_billings_updated_at
  BEFORE UPDATE ON contract_billings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
