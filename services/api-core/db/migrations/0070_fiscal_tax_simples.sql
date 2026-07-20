-- Migration 0070: Módulo Fiscal — tabelas do Simples Nacional versionadas.
--
-- 1) Versiona tax_simples_nacional_brackets por ano de vigência (PK passa a
--    (vigencia_ano, anexo, faixa)) — parametrização anual SEM mudança de
--    código. O resolver getSimplesEffectiveRate ganha filtro de vigência na
--    MESMA entrega (senão a query retornaria N linhas e rows[0] seria
--    arbitrário). Seed do Anexo I preservado (backfill vigencia_ano=2018).
-- 2) Semeia Anexos II–V (LC 123/2006, redação da LC 155/2016, vigente 2018+).
-- 3) tax_simples_repartition: matriz de repartição por tributo (criada agora,
--    SEED na fase Produção com revisão contábil — Anexo IV sem CPP).
-- 4) tax_cnae_anexo_map: sugestão CNAE→Anexo (HEURÍSTICA, validação humana
--    obrigatória — o anexo decorre da natureza da atividade, não do CNAE).
-- 5) fiscal_revenue_monthly: ledger de receita segregada por competência e
--    empresa — base do RBT12 calculado por company_id (soma móvel 12m).
-- Tabelas tax_* são GLOBAIS (sem tenant_id, regra 33); fiscal_revenue_monthly
-- é por tenant/empresa.

ALTER TABLE tax_simples_nacional_brackets ADD COLUMN IF NOT EXISTS vigencia_ano SMALLINT NOT NULL DEFAULT 2018;
-- anexo era CHAR(1) (0039, só Anexo I); 'III' precisa de 3 chars.
ALTER TABLE tax_simples_nacional_brackets ALTER COLUMN anexo TYPE VARCHAR(3);
ALTER TABLE tax_simples_nacional_brackets DROP CONSTRAINT IF EXISTS tax_simples_nacional_brackets_pkey;
ALTER TABLE tax_simples_nacional_brackets ADD PRIMARY KEY (vigencia_ano, anexo, faixa);

INSERT INTO tax_simples_nacional_brackets (vigencia_ano, anexo, faixa, rbt12_min, rbt12_max, aliquota_nominal, parcela_deduzir) VALUES
  -- Anexo II — Indústria
  (2018, 'II', 1,          0.00,   180000.00,  4.50,      0.00),
  (2018, 'II', 2,     180000.01,   360000.00,  7.80,   5940.00),
  (2018, 'II', 3,     360000.01,   720000.00, 10.00,  13860.00),
  (2018, 'II', 4,     720000.01,  1800000.00, 11.20,  22500.00),
  (2018, 'II', 5,    1800000.01,  3600000.00, 14.70,  85500.00),
  (2018, 'II', 6,    3600000.01,  4800000.00, 30.00, 720000.00),
  -- Anexo III — Serviços (§5-B; Fator R >= 28% para atividades do §5-J)
  (2018, 'III', 1,         0.00,   180000.00,  6.00,      0.00),
  (2018, 'III', 2,    180000.01,   360000.00, 11.20,   9360.00),
  (2018, 'III', 3,    360000.01,   720000.00, 13.50,  17640.00),
  (2018, 'III', 4,    720000.01,  1800000.00, 16.00,  35640.00),
  (2018, 'III', 5,   1800000.01,  3600000.00, 21.00, 125640.00),
  (2018, 'III', 6,   3600000.01,  4800000.00, 33.00, 648000.00),
  -- Anexo IV — Serviços (§5-C: construção, advocacia, limpeza — CPP fora do DAS)
  (2018, 'IV', 1,          0.00,   180000.00,  4.50,      0.00),
  (2018, 'IV', 2,     180000.01,   360000.00,  9.00,   8100.00),
  (2018, 'IV', 3,     360000.01,   720000.00, 10.20,  12420.00),
  (2018, 'IV', 4,     720000.01,  1800000.00, 14.00,  39780.00),
  (2018, 'IV', 5,    1800000.01,  3600000.00, 22.00, 183780.00),
  (2018, 'IV', 6,    3600000.01,  4800000.00, 33.00, 828000.00),
  -- Anexo V — Serviços (§5-I; Fator R < 28%)
  (2018, 'V', 1,           0.00,   180000.00, 15.50,      0.00),
  (2018, 'V', 2,      180000.01,   360000.00, 18.00,   4500.00),
  (2018, 'V', 3,      360000.01,   720000.00, 19.50,   9900.00),
  (2018, 'V', 4,      720000.01,  1800000.00, 20.50,  17100.00),
  (2018, 'V', 5,     1800000.01,  3600000.00, 23.00,  62100.00),
  (2018, 'V', 6,     3600000.01,  4800000.00, 30.50, 540000.00)
ON CONFLICT (vigencia_ano, anexo, faixa) DO NOTHING;

-- Repartição do DAS por tributo (percentual da alíquota efetiva destinado a
-- cada tributo, por anexo/faixa/vigência). SEED na fase Produção (fonte
-- oficial + revisão contábil); Anexo IV NÃO tem coluna CPP preenchida (INSS
-- patronal recolhido por fora, via GPS).
CREATE TABLE tax_simples_repartition (
  vigencia_ano SMALLINT     NOT NULL,
  anexo        VARCHAR(3)   NOT NULL,
  faixa        SMALLINT     NOT NULL,
  irpj         NUMERIC(6,4) NOT NULL DEFAULT 0,
  csll         NUMERIC(6,4) NOT NULL DEFAULT 0,
  cofins       NUMERIC(6,4) NOT NULL DEFAULT 0,
  pis          NUMERIC(6,4) NOT NULL DEFAULT 0,
  cpp          NUMERIC(6,4) NOT NULL DEFAULT 0,
  icms         NUMERIC(6,4) NOT NULL DEFAULT 0,
  ipi          NUMERIC(6,4) NOT NULL DEFAULT 0,
  iss          NUMERIC(6,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (vigencia_ano, anexo, faixa)
);

-- Sugestão CNAE→Anexo — HEURÍSTICA de apoio ao cadastro, nunca autoridade
-- fiscal (LC123 art.18 §§5-B..5-F define por natureza da atividade).
CREATE TABLE tax_cnae_anexo_map (
  cnae               CHAR(7)    PRIMARY KEY,
  anexo              SMALLINT   NOT NULL CHECK (anexo BETWEEN 1 AND 5),
  fator_r_aplicavel  BOOLEAN    NOT NULL DEFAULT false,
  item_lc116         VARCHAR(10),
  notes              TEXT
);

-- Ledger de receita segregada por competência/empresa — fonte do RBT12
-- calculado (soma móvel 12m) por company_id. Idempotente por documento:
-- UNIQUE(source_doc_type, source_doc_id) impede contar a mesma nota 2x.
CREATE TABLE fiscal_revenue_monthly (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id         UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia        CHAR(7) NOT NULL, -- 'YYYY-MM'
  anexo              SMALLINT CHECK (anexo BETWEEN 1 AND 5),
  municipio_ibge     VARCHAR(10),
  cnae               CHAR(7),
  receita_bruta      NUMERIC(15,2) NOT NULL DEFAULT 0,
  receita_tributavel NUMERIC(15,2) NOT NULL DEFAULT 0,
  receita_isenta     NUMERIC(15,2) NOT NULL DEFAULT 0,
  receita_com_retencao NUMERIC(15,2) NOT NULL DEFAULT 0,
  receita_exportacao NUMERIC(15,2) NOT NULL DEFAULT 0,
  source_doc_type    VARCHAR(20) NOT NULL, -- 'invoice' | 'nfse' | 'pos_sale' | 'manual'
  source_doc_id      UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_fiscal_revenue_source
  ON fiscal_revenue_monthly (tenant_id, company_id, source_doc_type, source_doc_id)
  WHERE source_doc_id IS NOT NULL;
CREATE INDEX idx_fiscal_revenue_competencia ON fiscal_revenue_monthly (tenant_id, company_id, competencia);
