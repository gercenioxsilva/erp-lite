-- Migration 0068: Módulo Fiscal (Simples Nacional) — fundação transversal.
--
-- 1) fiscal_events: ÍNDICE UNIFICADO de auditoria fiscal (append-only).
--    Os *_events por agregado (nfse_events, e os futuros reconciliation_events/
--    draft_events/apuracao_events) continuam como log detalhado de cada
--    agregado; fiscal_events é a visão transversal "quem/quando/o quê" que o
--    dashboard de auditoria lê sem precisar de UNION de N tabelas. Dono único:
--    este arquivo. Os demais subdomínios fiscais só INSEREM (via
--    fiscalAuditService.record()), nunca criam/alteram esta tabela.
--
-- 2) company_id em pos_sales e orders: receita de PDV/marketplace precisa ser
--    atribuível a um CNPJ (nfe_configs) para RBT12/apuração/consolidação por
--    empresa funcionarem em tenant multiempresa. Backfill para a empresa
--    padrão do tenant (is_default, migration 0046); tenants sem empresa
--    cadastrada ficam NULL (a apuração ignora até o cadastro existir).

CREATE TABLE fiscal_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id         UUID REFERENCES nfe_configs(id) ON DELETE SET NULL,
  aggregate_type     VARCHAR(40) NOT NULL,
  aggregate_id       UUID,
  event_type         VARCHAR(60) NOT NULL,
  -- NULL = sistema (worker/job agendado), mesmo racional do created_by dos
  -- movement ledgers.
  actor_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Trilha documental: arquivo importado original, XML e PDF/DANFSe no S3,
  -- e o hash do documento para prova de integridade.
  source_file_s3_key TEXT,
  xml_s3_key         TEXT,
  pdf_s3_key         TEXT,
  payload_hash       VARCHAR(64),
  -- Nunca gravar segredo/certificado aqui (payloads passam por máscara no
  -- fiscalAuditService antes do insert).
  request_payload    JSONB,
  response_payload   JSONB,
  attempt            INTEGER,
  idempotency_key    VARCHAR(160),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência física: reprocessar o mesmo evento (SQS at-least-once, retry de
-- job) nunca duplica a linha — padrão cost_center_movements/scheduling.
CREATE UNIQUE INDEX uq_fiscal_events_idempotency
  ON fiscal_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_fiscal_events_aggregate ON fiscal_events (tenant_id, aggregate_type, aggregate_id);
CREATE INDEX idx_fiscal_events_created   ON fiscal_events (tenant_id, created_at);

-- ── company_id em pos_sales/orders ───────────────────────────────────────────
-- ON DELETE SET NULL: desativar/excluir a empresa não pode apagar vendas.
ALTER TABLE pos_sales ADD COLUMN company_id UUID REFERENCES nfe_configs(id) ON DELETE SET NULL;
ALTER TABLE orders    ADD COLUMN company_id UUID REFERENCES nfe_configs(id) ON DELETE SET NULL;

UPDATE pos_sales ps SET company_id = c.id
  FROM nfe_configs c
  WHERE c.tenant_id = ps.tenant_id AND c.is_default AND ps.company_id IS NULL;

UPDATE orders o SET company_id = c.id
  FROM nfe_configs c
  WHERE c.tenant_id = o.tenant_id AND c.is_default AND o.company_id IS NULL;

CREATE INDEX idx_pos_sales_company ON pos_sales (tenant_id, company_id);
CREATE INDEX idx_orders_company    ON orders    (tenant_id, company_id);
