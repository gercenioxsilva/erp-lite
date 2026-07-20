-- Migration 0073: Módulo Fiscal — motor de consolidação.
--
-- Agrupa transações CONCILIADAS (imported_transactions.matched) em rascunhos
-- de documento fiscal (fiscal_document_drafts) por regra parametrizável
-- (per_sale|daily|weekly|monthly|per_client|per_contract), com competência e
-- grouping_key DETERMINÍSTICOS (reprocessar nunca duplica: UNIQUE tenant+
-- grouping_key; cada venda em exatamente 1 draft: UNIQUE parcial tenant+
-- transaction). Sub-agrupamento por service_code na linha (LC116 heterogêneo
-- não vira 1 nota). O motor NFS-e só emite o nfse_invoice já materializado.

CREATE TABLE consolidation_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES clients(id)           ON DELETE CASCADE, -- override por cliente
  contract_id  UUID REFERENCES service_contracts(id) ON DELETE CASCADE, -- override por contrato
  strategy     VARCHAR(12) NOT NULL DEFAULT 'monthly'
               CHECK (strategy IN ('per_sale','daily','weekly','monthly','per_client','per_contract')),
  service_code VARCHAR(10),          -- override do código LC116 default da empresa
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 1 regra ativa por escopo (empresa / empresa+cliente / empresa+contrato).
CREATE UNIQUE INDEX uq_consolidation_rules_scope ON consolidation_rules (
  tenant_id, company_id,
  COALESCE(client_id,   '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(contract_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE is_active;

CREATE TABLE fiscal_document_drafts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  rule_id           UUID REFERENCES consolidation_rules(id) ON DELETE SET NULL,
  strategy_snapshot VARCHAR(12) NOT NULL,  -- regra mudou ≠ draft re-agrupa
  doc_type          VARCHAR(6)  NOT NULL DEFAULT 'nfse' CHECK (doc_type IN ('nfse','nfe')),
  competency_ref    CHAR(7) NOT NULL,      -- 'YYYY-MM'
  service_code      VARCHAR(10),
  grouping_key      VARCHAR(200) NOT NULL,
  status            VARCHAR(12) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','sealed','calculated','emitting','emitted','failed','cancelled')),
  amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  -- Snapshot tributário (memória): p/ Simples o ISS é INFORMATIVO (já está na
  -- efetiva do DAS; a nota não recolhe ISS avulso — só ISS retido).
  simples_effective_rate NUMERIC(6,4),
  rbt12             NUMERIC(15,2),
  anexo             VARCHAR(3),
  iss_rate          NUMERIC(5,2),
  iss_value         NUMERIC(15,2),
  iss_retido        BOOLEAN NOT NULL DEFAULT false,
  nfse_id           UUID REFERENCES nfse_invoices(id) ON DELETE SET NULL, -- trava de dupla emissão
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_drafts_grouping ON fiscal_document_drafts (tenant_id, grouping_key);
CREATE INDEX idx_drafts_status ON fiscal_document_drafts (tenant_id, company_id, status, competency_ref);

CREATE TABLE fiscal_document_draft_lines (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  draft_id       UUID NOT NULL REFERENCES fiscal_document_drafts(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES imported_transactions(id) ON DELETE CASCADE,
  service_code   VARCHAR(10),
  amount         NUMERIC(15,2) NOT NULL,
  sale_date      DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Cada transação conciliada entra em EXATAMENTE 1 draft (attach idempotente).
CREATE UNIQUE INDEX uq_draft_lines_tx ON fiscal_document_draft_lines (tenant_id, transaction_id);

-- Log detalhado do agregado (espelho de nfse_events); o índice transversal é
-- fiscal_events (0068).
CREATE TABLE fiscal_document_draft_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  draft_id    UUID NOT NULL REFERENCES fiscal_document_drafts(id) ON DELETE CASCADE,
  event_type  VARCHAR(40) NOT NULL,
  payload     JSONB,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = sistema
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_draft_events_draft ON fiscal_document_draft_events (draft_id);
