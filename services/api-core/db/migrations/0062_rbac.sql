-- 0059_rbac.sql — RBAC dirigido por banco (permissions / roles / role_permissions)
--
-- DDL apenas. O SEED (catálogo de permissões + 5 papéis de sistema + seus
-- vínculos) é aplicado de forma idempotente no boot da API por
-- src/rbac/syncRbacCatalog.ts (mantém o código como fonte da verdade e permite
-- adicionar permissões só editando o catálogo, sem nova migração).

-- Catálogo global de permissões (module:action).
CREATE TABLE IF NOT EXISTS permissions (
  key         VARCHAR(60)  PRIMARY KEY,
  module      VARCHAR(40)  NOT NULL,
  action      VARCHAR(30)  NOT NULL,
  description VARCHAR(200)
);

-- Papéis: tenant_id NULL = papel de sistema (owner/admin/...); não-NULL = custom.
CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  key         VARCHAR(40)  NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  description VARCHAR(200),
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unicidade: um papel de sistema por key (tenant NULL); um papel custom por
-- (tenant, key). Índices parciais evitam o problema de NULL != NULL do UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS roles_system_key_uniq
  ON roles (key) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_key_uniq
  ON roles (tenant_id, key) WHERE tenant_id IS NOT NULL;

-- Vínculo papel → permissão.
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(60) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- users.role continua sendo a CHAVE do papel. Relaxar o CHECK que limitava aos
-- 5 valores fixos, para permitir atribuir papéis custom. A validação de papel
-- passa a ser em aplicação (contra a tabela roles do tenant + sistema).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
