-- Migration 0048: Integração Mercado Livre (Fase 1 — módulo api-core)
-- Uma conexão OAuth do Mercado Livre é vinculada a UMA EMPRESA (nfe_configs),
-- não ao tenant como um todo — uma conta ML corresponde a um CNPJ específico
-- (decisão só possível depois da fundação multi-empresa da migration 0046).
--
-- Segredos (access_token/refresh_token) ficam em texto puro nesta fase —
-- mesmo padrão já usado em itau_client_secret/focus_token_producao/
-- bank_accounts.itau_client_secret (nenhum segredo deste projeto usa KMS
-- hoje). Migração para envelope encryption via KMS fica para a Fase 2
-- (Lambda + Terraform), documentada no README, não nesta migration.

CREATE TABLE marketplace_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  provider          VARCHAR(30)  NOT NULL DEFAULT 'mercadolivre',
  ml_user_id        VARCHAR(50),
  nickname          VARCHAR(100),
  access_token      TEXT,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  scope             VARCHAR(100),
  status            VARCHAR(20) NOT NULL DEFAULT 'disconnected',
  connected_at      TIMESTAMPTZ,
  connected_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  disconnected_at   TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, provider)
);

-- Permite resolver "de qual empresa/tenant é esse webhook" a partir do
-- ml_user_id que o payload do Mercado Livre traz (topic/resource/user_id).
CREATE UNIQUE INDEX uq_marketplace_connections_ml_user
  ON marketplace_connections(ml_user_id) WHERE ml_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_marketplace_connections_updated_at ON marketplace_connections;
CREATE TRIGGER trg_marketplace_connections_updated_at
  BEFORE UPDATE ON marketplace_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE material_marketplace_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  material_id     UUID NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  connection_id   UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
  ml_item_id      VARCHAR(50),
  ml_variation_id VARCHAR(50),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  sync_price      BOOLEAN NOT NULL DEFAULT true,
  sync_stock      BOOLEAN NOT NULL DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (material_id, connection_id)
);

DROP TRIGGER IF EXISTS trg_material_marketplace_links_updated_at ON material_marketplace_links;
CREATE TRIGGER trg_material_marketplace_links_updated_at
  BEFORE UPDATE ON material_marketplace_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Append-only (mesmo padrão de nfe_events) — auditoria + idempotência. O
-- payload do webhook NUNCA é fonte de verdade, só um gatilho para buscar o
-- recurso real via API autenticada (regra análoga à regra 38 sobre o link de
-- roteamento do técnico nunca conceder acesso por si só).
CREATE TABLE marketplace_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        VARCHAR(30) NOT NULL DEFAULT 'mercadolivre',
  ml_user_id      VARCHAR(50),
  topic           VARCHAR(50),
  resource        VARCHAR(255),
  application_id  VARCHAR(50),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  status          VARCHAR(20) NOT NULL DEFAULT 'received',
  error_message   TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

-- Fan-out em orders (nullable, aditivo — mesmo padrão de seller_id/cost_center_id).
-- Usado pelo marketplaceSyncResultsWorker para importar pedidos do ML quando a
-- Fase 2 (Lambda) estiver publicando resultados — pronto e testável hoje, inerte
-- até lá (mesmo raciocínio de graceful no-op já usado em toda emissão fiscal).
ALTER TABLE orders ADD COLUMN marketplace_order_id VARCHAR(50);
ALTER TABLE orders ADD COLUMN origin VARCHAR(20) NOT NULL DEFAULT 'erp';
CREATE UNIQUE INDEX uq_orders_marketplace_order
  ON orders(tenant_id, marketplace_order_id) WHERE marketplace_order_id IS NOT NULL;
