-- Migration 0077: Módulo Fiscal — fechamento de competência + trava.
--
-- FECHAR ≠ TRAVAR (decisão canônica): o fechamento executa o checklist
-- (concilia→consolida→emite→apura→inconsistências→relatório) e termina
-- 'completed_with_warnings' se houver draft aguardando autorização (a emissão
-- é assíncrona); a TRAVA é ação separada, só habilitada quando todos os
-- drafts da competência estão authorized/cancelled. Late-arriving: documento
-- autorizado pós-trava NUNCA é bloqueado no ledger/journal (fato gerador
-- real) — posta + alerta critical + fluxo reabrir (reason) → reapurar.
-- Locks e runs no MESMO arquivo (FK interna closing_run_id).

CREATE TABLE fiscal_closing_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia  CHAR(7) NOT NULL,
  status       VARCHAR(24) NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','completed','completed_with_warnings','failed')),
  -- Checklist por etapa: {reconcile,consolidate,emit,apurar,inconsistencias,
  -- alertas,report} → {status: pending|ok|warning|error, detail, at}.
  steps        JSONB NOT NULL DEFAULT '{}',
  report       JSONB,
  started_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);
-- 2º fechamento concorrente da mesma competência cai no 23505 → 409.
CREATE UNIQUE INDEX uq_closing_running
  ON fiscal_closing_runs (tenant_id, company_id, competencia) WHERE status = 'running';
CREATE INDEX idx_closing_runs ON fiscal_closing_runs (tenant_id, company_id, competencia, started_at DESC);

CREATE TABLE fiscal_period_locks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id     UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia    CHAR(7) NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','unlocked')),
  closing_run_id UUID REFERENCES fiscal_closing_runs(id) ON DELETE SET NULL,
  report         JSONB,
  locked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlocked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at    TIMESTAMPTZ,
  unlock_reason  TEXT,
  UNIQUE (tenant_id, company_id, competencia)  -- re-travar = UPDATE; histórico em fiscal_events
);
CREATE INDEX idx_period_locks_lookup ON fiscal_period_locks (tenant_id, competencia) WHERE status = 'locked';
