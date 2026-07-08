-- NF-e de Simples Remessa (conserto, demonstração, comodato, industrialização,
-- amostra grátis, devolução) — documento fiscal não oneroso, distinto de
-- venda (invoices) e de NFS-e (nfse_invoices). Mesmo vocabulário de rastreio
-- de NF-e já usado em `invoices` (nfe_status/nfe_chave/...), mesmo padrão de
-- multi-empresa (company_id nullable → nfe_configs, regra 40).

CREATE TABLE IF NOT EXISTS simples_remessas (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id         UUID          REFERENCES nfe_configs(id) ON DELETE SET NULL,
  client_id          UUID          NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  -- Retorno de remessa: quando não nulo, esta linha É o retorno da remessa
  -- original apontada aqui — mesma tabela, sem entidade paralela.
  parent_remessa_id  UUID          REFERENCES simples_remessas(id) ON DELETE SET NULL,
  motivo             VARCHAR(30)   NOT NULL, -- conserto|demonstracao|comodato|industrializacao|amostra_gratis|devolucao
  cfop               VARCHAR(5)    NOT NULL,
  natureza_operacao  VARCHAR(100)  NOT NULL,
  -- Único eixo de status (draft/pending/processing/authorized/rejected/cancelled)
  -- — diferente de invoices, aqui não há um eixo "issued" separado do
  -- transmissão SEFAZ, então um único campo é suficiente (sem redundância).
  status             VARCHAR(20)   NOT NULL DEFAULT 'draft',
  subtotal           NUMERIC(15,2) NOT NULL DEFAULT 0,
  total              NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes              TEXT,
  -- Rastreio de NF-e — mesmo vocabulário de invoices.*
  nfe_chave          VARCHAR(50),
  nfe_protocol       VARCHAR(50),
  nfe_auth_date      TIMESTAMPTZ,
  nfe_reject_reason  TEXT,
  nfe_attempts       INTEGER       NOT NULL DEFAULT 0,
  nfe_xml_s3_key     VARCHAR(500),
  nfe_danfe_url      VARCHAR(500),
  -- Controle de baixa/devolução de estoque (idempotência — nunca baixar/devolver duas vezes)
  stock_applied_at   TIMESTAMPTZ,
  created_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simples_remessas_tenant  ON simples_remessas(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simples_remessas_parent  ON simples_remessas(parent_remessa_id) WHERE parent_remessa_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS simples_remessa_items (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  simples_remessa_id UUID          NOT NULL REFERENCES simples_remessas(id) ON DELETE CASCADE,
  material_id        UUID          REFERENCES materials(id) ON DELETE SET NULL,
  name               VARCHAR(255)  NOT NULL,
  ncm_code           VARCHAR(10),
  cfop               VARCHAR(5),
  quantity           NUMERIC(15,3) NOT NULL,
  unit_price         NUMERIC(15,2) NOT NULL,
  total              NUMERIC(15,2) NOT NULL,
  -- Situação tributária de suspensão (regra 51) — resolvida pelo domínio de
  -- remessa, independente do class_trib/CST cadastrado no material p/ venda.
  icms_cst           VARCHAR(3),
  class_trib         VARCHAR(6),
  ibs_rate           NUMERIC(6,3)  NOT NULL DEFAULT 0,
  ibs_value          NUMERIC(15,2) NOT NULL DEFAULT 0,
  cbs_rate           NUMERIC(6,3)  NOT NULL DEFAULT 0,
  cbs_value          NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simples_remessa_items_remessa ON simples_remessa_items(simples_remessa_id);

-- Append-only (mesmo padrão de nfe_events/nfse_events) — nunca UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS simples_remessa_events (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  simples_remessa_id UUID          NOT NULL REFERENCES simples_remessas(id) ON DELETE CASCADE,
  tenant_id          UUID          NOT NULL,
  event_type         VARCHAR(50)   NOT NULL,
  status_code        VARCHAR(10),
  protocol           VARCHAR(50),
  payload            JSONB,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simples_remessa_events_remessa ON simples_remessa_events(simples_remessa_id);
