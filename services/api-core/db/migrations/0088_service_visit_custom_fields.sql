-- Campos Personalizados de Visita Técnica — mesmo desenho EAV de
-- contract_field_definitions/contract_field_values (migration 0072, regra
-- 71), aplicado a service_visits em vez de service_contracts: cada tenant
-- define seu próprio schema de campos (chave/valor tipado) — mas quem
-- PREENCHE o valor é o técnico de campo, no portal dele, no momento da
-- visita (diferente de contrato, onde o próprio backoffice preenche).
CREATE TABLE IF NOT EXISTS service_visit_field_definitions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_key    VARCHAR(60)  NOT NULL, -- slug derivado do label na criação, imutável depois
  label        VARCHAR(120) NOT NULL,
  field_type   VARCHAR(20)  NOT NULL,
  required     BOOLEAN      NOT NULL DEFAULT false,
  sort_order   SMALLINT     NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT true, -- soft-delete (regra 8) — nunca some de visitas já respondidas
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, field_key)
);
ALTER TABLE service_visit_field_definitions DROP CONSTRAINT IF EXISTS chk_service_visit_field_definitions_type;
ALTER TABLE service_visit_field_definitions ADD CONSTRAINT chk_service_visit_field_definitions_type
  CHECK (field_type IN ('text', 'decimal', 'integer', 'date', 'boolean'));

CREATE TABLE IF NOT EXISTS service_visit_field_values (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  service_visit_id      UUID        NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  field_definition_id   UUID        NOT NULL REFERENCES service_visit_field_definitions(id) ON DELETE CASCADE,
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  value                 TEXT,       -- sempre texto; tipagem/formatação aplicada na leitura, conforme field_type
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_visit_id, field_definition_id)
);
CREATE INDEX IF NOT EXISTS idx_service_visit_field_values_visit ON service_visit_field_values(service_visit_id);

DROP TRIGGER IF EXISTS trg_service_visit_field_definitions_updated_at ON service_visit_field_definitions;
CREATE TRIGGER trg_service_visit_field_definitions_updated_at
  BEFORE UPDATE ON service_visit_field_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_service_visit_field_values_updated_at ON service_visit_field_values;
CREATE TRIGGER trg_service_visit_field_values_updated_at
  BEFORE UPDATE ON service_visit_field_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
