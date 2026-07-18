-- Contratos de Serviço passa a ser módulo opcional (`service_contracts`,
-- mesmo padrão de tenant_modules já usado por Mercado Livre/PDV/etc) — mas
-- já existe e já está em uso em produção, então cada tenant que já tem pelo
-- menos 1 contrato ganha o módulo habilitado automaticamente aqui, uma única
-- vez; tenants sem contrato nenhum ficam OFF por padrão, como qualquer
-- módulo novo (nunca habilitado por trás do usuário).
INSERT INTO tenant_modules (tenant_id, module_key, enabled, enabled_at)
SELECT DISTINCT tenant_id, 'service_contracts', true, now()
FROM service_contracts
ON CONFLICT (tenant_id, module_key) DO NOTHING;

-- Campos personalizados de contrato: cada tenant define seu próprio schema
-- (chave/valor tipado) — aplicado a todo contrato criado depois, renderizado
-- dinamicamente na tela de configuração do contrato e no documento
-- impresso/enviado por e-mail.
CREATE TABLE IF NOT EXISTS contract_field_definitions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  field_key    VARCHAR(60)  NOT NULL, -- slug derivado do label na criação, imutável depois
  label        VARCHAR(120) NOT NULL,
  field_type   VARCHAR(20)  NOT NULL,
  required     BOOLEAN      NOT NULL DEFAULT false,
  sort_order   SMALLINT     NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT true, -- soft-delete (regra 8) — nunca some de contratos já criados
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, field_key)
);
ALTER TABLE contract_field_definitions DROP CONSTRAINT IF EXISTS chk_contract_field_definitions_type;
ALTER TABLE contract_field_definitions ADD CONSTRAINT chk_contract_field_definitions_type
  CHECK (field_type IN ('text', 'decimal', 'integer', 'date', 'boolean'));

CREATE TABLE IF NOT EXISTS contract_field_values (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID        NOT NULL REFERENCES service_contracts(id) ON DELETE CASCADE,
  field_definition_id   UUID        NOT NULL REFERENCES contract_field_definitions(id) ON DELETE CASCADE,
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  value                 TEXT,       -- sempre texto; tipagem/formatação aplicada na leitura, conforme field_type
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, field_definition_id)
);
CREATE INDEX IF NOT EXISTS idx_contract_field_values_contract ON contract_field_values(contract_id);

DROP TRIGGER IF EXISTS trg_contract_field_definitions_updated_at ON contract_field_definitions;
CREATE TRIGGER trg_contract_field_definitions_updated_at
  BEFORE UPDATE ON contract_field_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_contract_field_values_updated_at ON contract_field_values;
CREATE TRIGGER trg_contract_field_values_updated_at
  BEFORE UPDATE ON contract_field_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
