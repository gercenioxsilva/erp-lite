-- Funil de Vendas / CRM (regra correspondente no README) — módulo opcional,
-- desligado por padrão (mesmo mecanismo genérico de tenant_modules já usado
-- por Ordens de Serviço/Multi-Empresa/Mercado Livre/PDV).
--
-- Modelo: sales_pipeline_stages (etapas configuráveis por tenant) +
-- sales_opportunities (a oportunidade em si, status aberto/ganho/perdido é
-- um eixo separado da etapa) + sales_opportunity_activities (timeline
-- append-only, inclusive de mudança de etapa, logada automaticamente pelo
-- service). Nenhuma tabela existente é alterada.

CREATE TABLE sales_pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        varchar(80) NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_pipeline_stages_tenant ON sales_pipeline_stages(tenant_id);

CREATE TABLE sales_opportunities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stage_id            uuid NOT NULL REFERENCES sales_pipeline_stages(id) ON DELETE RESTRICT,
  client_id           uuid REFERENCES clients(id) ON DELETE SET NULL,
  seller_id           uuid REFERENCES sellers(id) ON DELETE SET NULL,
  proposal_id         uuid REFERENCES proposals(id) ON DELETE SET NULL,
  title               varchar(255) NOT NULL,
  contact_name        varchar(255),
  contact_email       varchar(255),
  contact_phone       varchar(30),
  value               decimal(15,2) NOT NULL DEFAULT 0,
  source              varchar(60),
  status              varchar(20) NOT NULL DEFAULT 'open',
  lost_reason         text,
  expected_close_date date,
  notes               text,
  won_at              timestamptz,
  lost_at             timestamptz,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_opportunities_status_check CHECK (status IN ('open', 'won', 'lost'))
);

CREATE INDEX idx_sales_opportunities_tenant ON sales_opportunities(tenant_id);
CREATE INDEX idx_sales_opportunities_stage  ON sales_opportunities(stage_id);
CREATE INDEX idx_sales_opportunities_status ON sales_opportunities(tenant_id, status);

CREATE TABLE sales_opportunity_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL REFERENCES sales_opportunities(id) ON DELETE CASCADE,
  type            varchar(20) NOT NULL,
  description     text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_opportunity_activities_type_check
    CHECK (type IN ('note', 'call', 'meeting', 'stage_change', 'won', 'lost', 'proposal_linked'))
);

CREATE INDEX idx_sales_opportunity_activities_opportunity ON sales_opportunity_activities(opportunity_id);
