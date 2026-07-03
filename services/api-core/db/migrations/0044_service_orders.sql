-- Ordens de Serviço / Visita Técnica (módulo opcional por tenant).
--
-- Modelo de segurança: o técnico é um usuário autenticado de verdade (users.role
-- = 'technician'), nunca um link público anônimo — CPF e assinatura do cliente só
-- têm valor probatório se amarrados a uma conta logada. O e-mail que o técnico
-- recebe é um link de ROTEAMENTO (leva à tela certa após login), nunca uma
-- credencial de acesso por si só.
--
-- tenant_modules: flag genérica de módulo opcional habilitado por tenant — não é
-- específica de OS, é reaproveitável por qualquer módulo de nicho futuro.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'user', 'technician'));

CREATE TABLE IF NOT EXISTS tenant_modules (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_key   VARCHAR(40)  NOT NULL,
  enabled      BOOLEAN      NOT NULL DEFAULT false,
  enabled_at   TIMESTAMPTZ,
  enabled_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, module_key)
);

DROP TRIGGER IF EXISTS trg_tenant_modules_updated_at ON tenant_modules;
CREATE TRIGGER trg_tenant_modules_updated_at
  BEFORE UPDATE ON tenant_modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Perfil do técnico — 1:1 obrigatório com users (diferente de sellers, cujo
-- user_id é opcional): aqui o login é o próprio requisito de segurança, não uma
-- conveniência. CPF é capturado uma única vez no cadastro, nunca redigitado
-- por visita.
CREATE TABLE IF NOT EXISTS technicians (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  phone        VARCHAR(20),
  cpf          VARCHAR(11)  NOT NULL,
  specialty    VARCHAR(120),
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_technicians_tenant ON technicians(tenant_id);
CREATE INDEX IF NOT EXISTS idx_technicians_active ON technicians(tenant_id, is_active);

DROP TRIGGER IF EXISTS trg_technicians_updated_at ON technicians;
CREATE TRIGGER trg_technicians_updated_at
  BEFORE UPDATE ON technicians
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Ordem de Serviço. cost_center_id opcional — reaproveita o motor de estoque
-- existente se a OS consumir peças de um centro de custo (não obrigatório).
CREATE TABLE IF NOT EXISTS service_orders (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id      UUID          REFERENCES clients(id) ON DELETE SET NULL,
  cost_center_id UUID          REFERENCES cost_centers(id) ON DELETE SET NULL,
  number         VARCHAR(20)   NOT NULL,
  title          VARCHAR(255)  NOT NULL,
  description    TEXT,
  type           VARCHAR(20)   NOT NULL DEFAULT 'maintenance',
  status         VARCHAR(20)   NOT NULL DEFAULT 'draft',
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  total          NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, number),
  CONSTRAINT chk_service_orders_type   CHECK (type   IN ('installation', 'maintenance', 'repair', 'inspection')),
  CONSTRAINT chk_service_orders_status CHECK (status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_service_orders_tenant ON service_orders(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_orders_client ON service_orders(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_status ON service_orders(tenant_id, status);

DROP TRIGGER IF EXISTS trg_service_orders_updated_at ON service_orders;
CREATE TRIGGER trg_service_orders_updated_at
  BEFORE UPDATE ON service_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS service_order_items (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id UUID          NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  material_id      UUID          REFERENCES materials(id) ON DELETE SET NULL,
  description      VARCHAR(255)  NOT NULL,
  quantity         NUMERIC(15,3) NOT NULL,
  unit_price       NUMERIC(15,2) NOT NULL DEFAULT 0,
  total            NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_order_items_order ON service_order_items(service_order_id);

-- Visita técnica — 1:N com a OS (uma OS pode exigir várias idas ao local).
-- public_token é só ROTEAMENTO (qual visita mostrar após login), não autorização
-- — a autorização de verdade é o JWT do técnico logado + technician_id da visita
-- batendo com o technicianId do token. token_expires_at limita a janela de uso
-- do link (diferente do token indefinido de proposals).
-- technician_name/technician_cpf são SNAPSHOT no check-in (mesmo raciocínio de
-- order_items/invoice_items congelarem nome/preço) — o registro histórico da
-- visita fica íntegro mesmo que o cadastro do técnico mude depois.
CREATE TABLE IF NOT EXISTS service_visits (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_order_id   UUID         NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  technician_id      UUID         NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  scheduled_at       TIMESTAMPTZ  NOT NULL,
  status             VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  routing_token      VARCHAR(64)  NOT NULL,
  token_expires_at   TIMESTAMPTZ  NOT NULL,
  checked_in_at      TIMESTAMPTZ,
  checked_out_at     TIMESTAMPTZ,
  technician_name    VARCHAR(255),
  technician_cpf     VARCHAR(11),
  report_notes       TEXT,
  signature_s3_key   TEXT,
  signed_by_name     VARCHAR(255),
  signed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (routing_token),
  CONSTRAINT chk_service_visits_status CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'))
);

CREATE INDEX IF NOT EXISTS idx_service_visits_tenant     ON service_visits(tenant_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_visits_order      ON service_visits(service_order_id);
CREATE INDEX IF NOT EXISTS idx_service_visits_technician ON service_visits(technician_id, status);

DROP TRIGGER IF EXISTS trg_service_visits_updated_at ON service_visits;
CREATE TRIGGER trg_service_visits_updated_at
  BEFORE UPDATE ON service_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Fotos da visita — append-only (nunca deletado, mesmo padrão de
-- cost_center_movements/nfe_events). idempotency_key é gerada no navegador
-- (UUID) antes do upload — mesma chave vira o sufixo da key no S3 e o valor
-- UNIQUE aqui, evitando duplicidade em caso de retry de rede (mesmo padrão de
-- cost_center_movements/commission_entries).
CREATE TABLE IF NOT EXISTS service_visit_photos (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_visit_id  UUID         NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE,
  s3_key            TEXT         NOT NULL,
  content_type      VARCHAR(60)  NOT NULL,
  file_size_bytes   INTEGER      NOT NULL,
  caption           VARCHAR(255),
  idempotency_key   VARCHAR(80)  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_service_visit_photos_visit ON service_visit_photos(service_visit_id, created_at);
