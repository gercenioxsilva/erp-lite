-- ============================================================
-- Migrations pendentes: 0015 a 0018
-- Execute este arquivo contra o banco de dados usando psql:
--   psql "$DATABASE_URL" -f scripts/apply_pending_migrations.sql
-- Ou via DBeaver / pgAdmin / qualquer cliente SQL.
-- As migrações são idempotentes (IF NOT EXISTS / IF NOT EXISTS).
-- ============================================================

-- ── 0015: Contatos de Clientes ──────────────────────────────
CREATE TABLE IF NOT EXISTS client_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_type VARCHAR(30) NOT NULL DEFAULT 'comercial',
  name         VARCHAR(255),
  email        VARCHAR(255),
  phone        VARCHAR(20),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_tenant ON client_contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON client_contacts(client_id, is_active);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_client_contacts_updated_at') THEN
    CREATE TRIGGER update_client_contacts_updated_at
      BEFORE UPDATE ON client_contacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

INSERT INTO schema_migrations (migration) VALUES ('0015_client_contacts.sql')
  ON CONFLICT DO NOTHING;

-- ── 0016: Contratos de Serviço + Faturas de Contrato ────────
CREATE TABLE IF NOT EXISTS service_contracts (
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

CREATE TABLE IF NOT EXISTS contract_billings (
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

CREATE INDEX IF NOT EXISTS idx_service_contracts_tenant   ON service_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_client   ON service_contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_service_contracts_status   ON service_contracts(tenant_id, status, billing_day);
CREATE INDEX IF NOT EXISTS idx_contract_billings_contract ON contract_billings(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_billings_due      ON contract_billings(due_date);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_service_contracts_updated_at') THEN
    CREATE TRIGGER update_service_contracts_updated_at
      BEFORE UPDATE ON service_contracts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contract_billings_updated_at') THEN
    CREATE TRIGGER update_contract_billings_updated_at
      BEFORE UPDATE ON contract_billings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

INSERT INTO schema_migrations (migration) VALUES ('0016_service_contracts.sql')
  ON CONFLICT DO NOTHING;

-- ── 0017: Tokens Focus NF-e por Tenant ──────────────────────
ALTER TABLE nfe_configs
  ADD COLUMN IF NOT EXISTS focus_token_homologacao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS focus_token_producao    VARCHAR(255);

INSERT INTO schema_migrations (migration) VALUES ('0017_nfe_tokens.sql')
  ON CONFLICT DO NOTHING;

-- ── 0018: Imagens de Materiais (1:N) ────────────────────────
CREATE TABLE IF NOT EXISTS material_images (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  material_id UUID        NOT NULL REFERENCES materials(id)  ON DELETE CASCADE,
  image_data  TEXT        NOT NULL,
  filename    VARCHAR(255),
  position    SMALLINT    NOT NULL DEFAULT 0,
  is_cover    BOOLEAN     NOT NULL DEFAULT false,
  alt         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS material_images_material_id ON material_images(material_id);
CREATE INDEX IF NOT EXISTS material_images_tenant_id   ON material_images(tenant_id);

INSERT INTO schema_migrations (migration) VALUES ('0018_material_images.sql')
  ON CONFLICT DO NOTHING;

-- ── Verificação final ────────────────────────────────────────
SELECT migration, applied_at FROM schema_migrations ORDER BY applied_at;
