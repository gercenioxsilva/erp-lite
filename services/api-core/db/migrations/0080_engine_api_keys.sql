-- Migration 0080: Fiscal Engine API — chaves de API + medição de uso.
--
-- v1 do Engine é 100% cálculo puro (stateless): nenhum dado do consumidor é
-- persistido — só a identidade da chave e contadores de uso. O segredo da
-- chave NUNCA é armazenado: guardamos key_hash (SHA-256) e um key_prefix
-- curto para lookup (padrão Stripe). Revogação é soft (status) — nunca
-- DELETE físico, a chave revogada continua auditável em api_key_usage.

CREATE TABLE api_keys (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(120)  NOT NULL,
  key_prefix         VARCHAR(20)   NOT NULL,  -- ex.: 'ek_live_ab12' — lookup O(1)
  key_hash           CHAR(64)      NOT NULL,  -- SHA-256 hex do segredo completo
  scopes             JSONB         NOT NULL DEFAULT '["engine"]',
  rate_limit_per_min SMALLINT      NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
  status             VARCHAR(10)   NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_used_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id, created_at DESC);

-- Medição por chave/dia/endpoint — base do billing futuro (v1 só mede).
-- UPSERT increment em toda chamada autenticada (fire-and-forget na rota).
CREATE TABLE api_key_usage (
  api_key_id  UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  dia         DATE        NOT NULL,
  endpoint    VARCHAR(80) NOT NULL,
  count       INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, dia, endpoint)
);
