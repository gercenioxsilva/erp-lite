-- Migration 0079: Transmissão PGDAS-D via SERPRO Integra Contador.
--
-- CORRIGE a premissa falsa do módulo (o PGDAS-D TEM API oficial: SERPRO
-- Integra Contador — TRANSDECLARACAO11 transmite, GERARDAS12 gera o DAS).
--
-- pgdasd_transmissions é um AGREGADO SEPARADO, deliberadamente NÃO um status em
-- simples_apuracao: exportApuracao faz set({status:'exported'}) incondicional,
-- então um status 'transmitted' seria clobbered por um clique posterior em
-- "Roteiro". A UI cruza por LEFT JOIN.
--
-- Ciclo de vida (Fase 0 só cria 'building'; rede vem nas Fases 1-3):
--   building        -- payload montado, nada saiu (Fase 0)
--   sent            -- Declarar enviado, aguardando resposta
--   confirmed       -- declaração transmitida (numero_declaracao presente)
--   failed          -- rejeição determinística (pode reprocessar)
--   failed_unknown  -- TERMINAL: timeout depois dos bytes saírem — os bytes
--                      PODEM ter chegado. Declarar NÃO tem idempotency key;
--                      NUNCA auto-retry. Reconciliar via CONSULTIMADECREC14.
--
-- indicador_transmissao=false é a CONFERÊNCIA (a RFB calcula e devolve os
-- números dela sem transmitir — zero efeito legal). true é o ato jurídico.

CREATE TABLE pgdasd_transmissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id)         ON DELETE CASCADE,
  company_id           UUID NOT NULL REFERENCES nfe_configs(id)     ON DELETE CASCADE,
  apuracao_id          UUID NOT NULL REFERENCES simples_apuracao(id) ON DELETE CASCADE,
  competencia          CHAR(7) NOT NULL,                 -- 'YYYY-MM'
  indicador_transmissao BOOLEAN NOT NULL DEFAULT false,  -- false=conferência, true=transmitir
  status               VARCHAR(16) NOT NULL DEFAULT 'building'
                         CHECK (status IN ('building','sent','confirmed','failed','failed_unknown')),
  -- Snapshot do que foi (ou seria) enviado — a memória do ato, auditável.
  payload_dados        JSONB NOT NULL,                   -- o objeto `dados` do TRANSDECLARACAO11
  -- Resposta da RFB (Fases 1-3).
  numero_declaracao    VARCHAR(30),                      -- protocolo da declaração transmitida
  valores_rfb          JSONB,                            -- valores devidos calculados pela RFB (conferência/diff)
  das_pdf_s3_key       VARCHAR(255),                     -- GERARDAS12: PDF do DAS (Fase 3; hoje NULL)
  erro_codigo          VARCHAR(60),
  erro_mensagem        TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trava de dupla transmissão EM VOO: no máximo 1 transmissão real (não-
-- conferência) building/sent por competência+empresa. NÃO um UNIQUE(apuracao_id)
-- — isso proibiria retificadora (correção mensal de rotina) e deixaria o ERP
-- divergir da RFB em silêncio, o pior fim para um módulo fiscal.
CREATE UNIQUE INDEX uq_pgdasd_inflight
  ON pgdasd_transmissions (tenant_id, company_id, competencia)
  WHERE indicador_transmissao AND status IN ('building','sent');

CREATE INDEX idx_pgdasd_apuracao ON pgdasd_transmissions (apuracao_id);
CREATE INDEX idx_pgdasd_competencia ON pgdasd_transmissions (tenant_id, company_id, competencia);
