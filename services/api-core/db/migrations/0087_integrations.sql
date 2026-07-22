-- Migration 0087: credenciais de integração por tenant + trilha de chamadas.
--
-- Contexto: até aqui toda credencial de integração vivia em ENV de plataforma
-- (SERPRO_*, PLUGGY_*, FOCUS_NFE_TOKEN, GOOGLE_*), o que obriga redeploy do ECS
-- para trocar qualquer chave e impede que cada cliente use a PRÓPRIA conta.
-- Decisão (2026-07-22): credencial de integração é POR TENANT, editável na tela
-- de Integrações — mesmo padrão que C6 Bank e WhatsApp já usam (credenciais
-- lidas da mensagem SQS / de whatsapp_accounts, nunca de ENV).
--
-- O ENV NÃO morre: vira FALLBACK de plataforma. resolveCredentials() tenta o
-- tenant primeiro e cai no ENV — sem isso, todo tenant que já emite hoje via
-- token mestre Focus pararia no deploy desta migration.
--
-- O catálogo (quais campos cada provider tem, quais são obrigatórios, quais
-- serviços ele habilita) fica em CÓDIGO (services/integrations/catalog.ts), não
-- aqui: é forma, não dado. Uma coluna a mais no banco por campo novo de
-- provider seria migration a cada integração.
--
-- ⚠ credentials é JSONB em TEXTO PURO — mesma decisão (e mesma dívida) de
-- fiscal_certificates.credentials na 0069. Cifrar aqui enquanto o .pfx do
-- certificado A1 segue em claro ao lado seria falsa sensação de segurança; KMS
-- é uma fase separada, para os dois juntos. O acesso já é restrito por RBAC
-- (tenant_modules:manage) e a API NUNCA devolve o valor, só se está preenchido.

CREATE TABLE IF NOT EXISTS integration_providers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Chave do catálogo em código ('serpro', 'focus_nfe', 'pluggy',
  -- 'google_calendar'). Sem FK/CHECK de propósito: adicionar provider novo é
  -- mudança de código, não migration.
  provider_key VARCHAR(40)  NOT NULL,
  -- 'sandbox' | 'production'. O par (provider, ambiente) é a unidade que a UI
  -- mostra como card — o mesmo provider aparece duas vezes, uma por ambiente,
  -- e cada um tem credencial e toggle próprios.
  environment  VARCHAR(20)  NOT NULL DEFAULT 'sandbox'
               CHECK (environment IN ('sandbox', 'production')),
  -- Desligado por padrão: criar a linha (salvar credencial) não liga a
  -- integração. Ligar é ato explícito — evita que um cliente que só colou a
  -- chave para testar comece a transmitir para a produção da SERPRO.
  enabled      BOOLEAN      NOT NULL DEFAULT false,
  credentials  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- Resultado do último Ping — cacheado para a UI pintar o card sem bater na
  -- rede a cada abertura da tela.
  last_ping_at      TIMESTAMPTZ,
  last_ping_ok      BOOLEAN,
  last_ping_message TEXT,
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider_key, environment)
);

CREATE INDEX IF NOT EXISTS idx_integration_providers_tenant
  ON integration_providers (tenant_id, provider_key);

-- Só UM ambiente ativo por provider/tenant: ligar produção tem de desligar o
-- sandbox. Sem isso, resolveCredentials() teria de desempatar em runtime e o
-- cliente descobriria pelo DAS transmitido no ambiente errado.
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_providers_enabled
  ON integration_providers (tenant_id, provider_key) WHERE enabled;

DROP TRIGGER IF EXISTS trg_integration_providers_updated_at ON integration_providers;
CREATE TRIGGER trg_integration_providers_updated_at
  BEFORE UPDATE ON integration_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trilha de chamadas às integrações ────────────────────────────────────────
-- Append-only (mesmo padrão de fiscal_integration_events/nfse_events, regra 1).
-- Alimenta a listagem "Logs de integração" no rodapé da tela e é o que responde
-- "ocorreu 100%?" depois de um sync/transmissão.
CREATE TABLE IF NOT EXISTS integration_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_key VARCHAR(40) NOT NULL,
  environment  VARCHAR(20),
  -- Operação chamada: 'ping', 'transmitir', 'gerar_das', 'sync', 'emitir'...
  service      VARCHAR(60) NOT NULL,
  status       VARCHAR(20) NOT NULL CHECK (status IN ('success', 'error')),
  http_status  SMALLINT,
  latency_ms   INTEGER,
  error_code   VARCHAR(80),
  -- Detalhe para o botão "Ver". NUNCA guarda credencial — o gravador aplica
  -- redação antes de persistir (ver integrationLogService.redact).
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice da listagem default (mais recentes do tenant).
CREATE INDEX IF NOT EXISTS idx_integration_logs_tenant
  ON integration_logs (tenant_id, created_at DESC);
-- Índices dos dois filtros da tela (provider / status).
CREATE INDEX IF NOT EXISTS idx_integration_logs_provider
  ON integration_logs (tenant_id, provider_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_logs_status
  ON integration_logs (tenant_id, status, created_at DESC);
