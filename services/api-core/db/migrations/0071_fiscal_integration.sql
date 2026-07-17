-- Cadastro automatizado da empresa no emissor fiscal + upload de certificado
-- digital (regra 70). O registro em si é feito de forma ASSÍNCRONA (fila
-- nfe_requests/nfe_results, type='company_registration', mesmo pipeline já
-- usado por nfe/nfse/remessa); o upload do certificado e o teste de conexão
-- são SÍNCRONOS (chamada direta em processo a partir da api-core).

-- IE da empresa — hoje só existe em tenants.state_reg (singleton), incompatível
-- com multi-empresa (regra 40: nfe_configs é quem representa cada empresa/CNPJ).
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(20);

-- Identificador da empresa no emissor fiscal, devolvido após o registro —
-- necessário pra qualquer chamada subsequente (upload de certificado, teste
-- de conexão, atualização de cadastro).
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS fiscal_integration_ref VARCHAR(50);

-- Status do registro assíncrono da empresa. NULL = nunca solicitado.
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS fiscal_registration_status VARCHAR(20);
ALTER TABLE nfe_configs DROP CONSTRAINT IF EXISTS chk_nfe_configs_fiscal_registration_status;
ALTER TABLE nfe_configs ADD CONSTRAINT chk_nfe_configs_fiscal_registration_status
  CHECK (fiscal_registration_status IS NULL OR fiscal_registration_status IN ('pending', 'processing', 'registered', 'error'));
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS fiscal_registration_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS fiscal_registration_error TEXT;

-- Metadados do certificado digital A1 (upload síncrono) — nunca guardamos o
-- arquivo/senha em si, só o que o emissor devolve após o upload (mesmo
-- racional de nunca persistir segredo em texto plano além do necessário).
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS certificado_cnpj VARCHAR(20);
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS certificado_valido_de DATE;
ALTER TABLE nfe_configs ADD COLUMN IF NOT EXISTS certificado_valido_ate DATE;

-- Trilha de auditoria append-only do processo de integração fiscal (registro,
-- upload de certificado, teste de conexão) — mesmo padrão de nfse_events/
-- simples_remessa_events (regra 1).
CREATE TABLE IF NOT EXISTS fiscal_integration_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL,
  event_type  VARCHAR(30) NOT NULL,
  status_code VARCHAR(20),
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fiscal_integration_events_company ON fiscal_integration_events(company_id, created_at DESC);
