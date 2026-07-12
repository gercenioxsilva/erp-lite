-- Migration 0076: Módulo Fiscal — central de alertas in-app.
--
-- fiscal_alerts é a PRIMEIRA central de notificações in-app do repo (e-mail/
-- WhatsApp existentes continuam como canais). Dedupe físico: dedupe_key TEXT
-- NOT NULL computado (rule|company|ref|período) + UNIQUE parcial em status
-- não-resolvido — UNIQUE composto com colunas NULL não deduplica em Postgres
-- (NULLS DISTINCT); alerta resolvido pode recorrer como NOVA linha (histórico).
-- Regras de DADOS vêm do inconsistencyDomain (dono único); aqui só as regras
-- temporais/estado (DAS vencendo, certificado expirando, faixa/Fator R).

CREATE TABLE fiscal_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id        UUID REFERENCES nfe_configs(id) ON DELETE CASCADE,  -- NULL = tenant-wide
  rule_key          VARCHAR(40) NOT NULL,
  severity          VARCHAR(8)  NOT NULL CHECK (severity IN ('info','warning','critical')),
  title             VARCHAR(200) NOT NULL,
  detail            TEXT,
  payload           JSONB,
  ref_type          VARCHAR(24),
  ref_id            UUID,
  periodo           CHAR(7),                    -- 'YYYY-MM' quando aplicável
  dedupe_key        VARCHAR(160) NOT NULL,
  status            VARCHAR(12) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at   TIMESTAMPTZ,
  resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  resolution        VARCHAR(8) CHECK (resolution IN ('auto','manual')),
  email_sent        BOOLEAN NOT NULL DEFAULT false,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_fiscal_alerts_dedupe
  ON fiscal_alerts (tenant_id, dedupe_key) WHERE status <> 'resolved';
CREATE INDEX idx_fiscal_alerts_list ON fiscal_alerts (tenant_id, status, severity, last_detected_at DESC);
-- Badge do sino: count barato só nos abertos.
CREATE INDEX idx_fiscal_alerts_open ON fiscal_alerts (tenant_id) WHERE status = 'open';
