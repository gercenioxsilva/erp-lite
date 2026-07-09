-- Controle de Perfil de Acesso por Tenant (RBAC) — regra correspondente no
-- README. O criador da conta (users.role = 'owner') passa a gerenciar
-- perfis de acesso configuráveis por tenant: cada perfil concede
-- 'view'/'manage' por área do sistema (recurso), e cada usuário (exceto
-- owner/technician, que continuam 100% definidos por users.role) é
-- vinculado a exatamente um perfil via users.access_profile_id.
--
-- Correção de segurança incluída nesta entrega (fora do escopo desta
-- migration, aplicada em código): GET/PATCH/DELETE /v1/users tinham falhas
-- de isolamento multi-tenant — corrigidas junto por serem o mesmo arquivo.

CREATE TABLE access_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        varchar(80) NOT NULL,
  description varchar(255),
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_profiles_tenant ON access_profiles(tenant_id);

CREATE TABLE access_profile_permissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_profile_id uuid NOT NULL REFERENCES access_profiles(id) ON DELETE CASCADE,
  resource          varchar(40) NOT NULL,
  action            varchar(10) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_profile_permissions_action_check CHECK (action IN ('view', 'manage')),
  CONSTRAINT uq_access_profile_permissions UNIQUE (access_profile_id, resource, action)
);

CREATE INDEX idx_access_profile_permissions_profile ON access_profile_permissions(access_profile_id);

-- Append-only — auditoria de mudança de perfil/permissão (área sensível,
-- mesmo padrão de nfe_events/sales_opportunity_activities).
CREATE TABLE access_profile_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_profile_id uuid REFERENCES access_profiles(id) ON DELETE SET NULL,
  type              varchar(30) NOT NULL,
  changed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  payload           jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_profile_events_type_check
    CHECK (type IN ('created', 'renamed', 'permissions_changed', 'deleted', 'user_assigned'))
);

CREATE INDEX idx_access_profile_events_tenant ON access_profile_events(tenant_id);

ALTER TABLE users ADD COLUMN access_profile_id uuid REFERENCES access_profiles(id) ON DELETE SET NULL;
