-- Migration 0066: Integração do Agendamento com o Google Calendar.
-- Uma conexão OAuth é vinculada a UM PROFISSIONAL (scheduling_professionals),
-- não ao tenant como um todo — cada barbeiro/instrutor conecta a própria conta
-- Google e vê os PRÓPRIOS atendimentos na agenda dele (a agenda do módulo já é
-- por profissional+dia). professional_id existe para 100% dos profissionais;
-- user_id/email são opcionais, então é o identificador natural para anexar o token.
--
-- Segredos (access_token/refresh_token) em texto puro nesta fase — mesmo padrão
-- de marketplace_connections/bank_accounts (nenhum segredo deste projeto usa KMS
-- hoje). Sync v1 é ERP→Google (mutão): sessão criada/aprovada/editada/cancelada
-- no ERP vira/atualiza/remove evento no Google.

CREATE TABLE scheduling_calendar_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id      UUID NOT NULL REFERENCES scheduling_professionals(id) ON DELETE CASCADE,
  provider             VARCHAR(30)  NOT NULL DEFAULT 'google',
  google_account_email VARCHAR(255),
  access_token         TEXT,
  refresh_token        TEXT,
  token_expires_at     TIMESTAMPTZ,
  scope                VARCHAR(255),
  calendar_id          VARCHAR(255) NOT NULL DEFAULT 'primary',
  status               VARCHAR(20)  NOT NULL DEFAULT 'disconnected',
  connected_at         TIMESTAMPTZ,
  connected_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  disconnected_at      TIMESTAMPTZ,
  last_refreshed_at    TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (professional_id, provider)
);

CREATE INDEX idx_scheduling_calendar_connections_tenant ON scheduling_calendar_connections(tenant_id);

DROP TRIGGER IF EXISTS trg_scheduling_calendar_connections_updated_at ON scheduling_calendar_connections;
CREATE TRIGGER trg_scheduling_calendar_connections_updated_at
  BEFORE UPDATE ON scheduling_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Mapa sessão → evento no Google, para permitir atualizar/remover o evento
-- depois (nullable — só preenchido quando a sessão foi de fato sincronizada;
-- ausente até lá, mesmo raciocínio de graceful no-op das demais integrações).
ALTER TABLE scheduling_sessions ADD COLUMN google_event_id VARCHAR(255);
