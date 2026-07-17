-- Módulo de Projetos (opcional por tenant, mesmo mecanismo de tenant_modules
-- já usado por service_orders/mercadolivre/scheduling — regra 42).
--
-- Um projeto agrega: profissionais alocados (técnicos e/ou vendedores, cada
-- um com um % de comissão INFORMATIVO — nunca lançado em commission_entries,
-- técnico não tem conceito de comissão real neste sistema) e pedidos de
-- venda / ordens de serviço já existentes, vinculados diretamente (project_id
-- nullable em orders/service_orders, mesmo padrão de cost_center_id) — não
-- uma tabela de junção, porque a relação é 1 projeto : N pedidos/OS.

CREATE TABLE IF NOT EXISTS projects (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id       UUID          REFERENCES clients(id) ON DELETE SET NULL,
  cost_center_id  UUID          REFERENCES cost_centers(id) ON DELETE SET NULL,
  number          VARCHAR(20)   NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  description     TEXT,
  total_value     NUMERIC(15,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20)   NOT NULL DEFAULT 'draft',
  start_date      DATE,
  end_date        DATE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, number),
  CONSTRAINT chk_projects_status CHECK (status IN ('draft','in_progress','completed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id) WHERE client_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Alocação de profissional (técnico OU vendedor, nunca ambos) num projeto.
-- commission_pct é só reporting — aparece no relatório de acompanhamento do
-- projeto, nunca alimenta commission_entries (regra 32 continua intocada).
CREATE TABLE IF NOT EXISTS project_professionals (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  professional_type VARCHAR(20)   NOT NULL,
  technician_id     UUID          REFERENCES technicians(id) ON DELETE CASCADE,
  seller_id         UUID          REFERENCES sellers(id) ON DELETE CASCADE,
  commission_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_project_professionals_type CHECK (professional_type IN ('technician','seller')),
  CONSTRAINT chk_project_professionals_one_ref CHECK (
    (professional_type = 'technician' AND technician_id IS NOT NULL AND seller_id IS NULL) OR
    (professional_type = 'seller'     AND seller_id     IS NOT NULL AND technician_id IS NULL)
  ),
  CONSTRAINT chk_project_professionals_pct CHECK (commission_pct >= 0 AND commission_pct <= 100)
);

-- Mesmo técnico/vendedor não pode ser alocado duas vezes no mesmo projeto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_professionals_technician
  ON project_professionals(project_id, technician_id) WHERE technician_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_professionals_seller
  ON project_professionals(project_id, seller_id) WHERE seller_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_professionals_project ON project_professionals(project_id);

-- Vínculo de pedidos de venda e ordens de serviço ao projeto — coluna direta
-- nullable, não tabela de junção (mesmo padrão de cost_center_id nessas duas
-- tabelas). PATCH /v1/orders/:id só edita em 'draft' (regra já existente),
-- então o vínculo/desvínculo ao projeto vive em rotas próprias do projeto
-- (POST/DELETE /v1/projects/:id/orders), funcionando em qualquer status do
-- pedido/OS, sem tocar nas rotas de orders.ts/serviceOrders.ts.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_project ON orders(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_project ON service_orders(project_id) WHERE project_id IS NOT NULL;
