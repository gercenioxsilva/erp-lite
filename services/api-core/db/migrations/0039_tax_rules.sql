-- Motor fiscal multi-estado: ICMS interno e interestadual por UF, FCP, ICMS-ST
-- (estrutura, sem dados pré-populados) e faixas do Simples Nacional (Anexo I).
--
-- IMPORTANTE — natureza dos dados seedados nesta migration:
--   * tax_icms_interstate_rates: gerada por REGRA LEGAL fixa (Resolução do Senado
--     22/89) — não é "dado que pode estar errado", é a fórmula da lei aplicada.
--   * tax_icms_internal_rates: alíquotas de REFERÊNCIA (valor "modal" mais comum
--     publicado por UF). Cada UF tem exceções por categoria de produto e as
--     alíquotas mudam por legislação estadual. NÃO usar em produção sem revisão
--     da contabilidade do tenant — ver coluna `notes`.
--   * tax_fcp_rates e tax_st_rules: criadas vazias (estrutura pronta). FCP varia
--     por lista de produtos por UF; ICMS-ST tem milhares de combinações NCM x UF
--     com convênios próprios — recomendação da análise é integrar um provedor de
--     dados fiscais em vez de manter manualmente (ver README v15.0).

-- ── ICMS interestadual (Resolução do Senado 22/89) ─────────────────────────────
CREATE TABLE IF NOT EXISTS tax_icms_interstate_rates (
  origin_uf CHAR(2)      NOT NULL,
  dest_uf   CHAR(2)      NOT NULL,
  rate      NUMERIC(5,2) NOT NULL,
  PRIMARY KEY (origin_uf, dest_uf)
);

-- Sul/Sudeste (exceto ES) → Norte/Nordeste/Centro-Oeste/ES = 7%; demais combinações
-- interestaduais = 12%. Gerado via CROSS JOIN da lista de UFs — é a regra legal
-- inteira, não uma amostra.
DO $$
DECLARE
  ufs TEXT[] := ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
                       'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
                       'SP','SE','TO'];
  sul_sudeste_sem_es TEXT[] := ARRAY['SP','RJ','MG','PR','SC','RS'];
  o TEXT; d TEXT;
BEGIN
  FOREACH o IN ARRAY ufs LOOP
    FOREACH d IN ARRAY ufs LOOP
      IF o <> d THEN
        INSERT INTO tax_icms_interstate_rates (origin_uf, dest_uf, rate)
        VALUES (
          o, d,
          CASE WHEN o = ANY(sul_sudeste_sem_es) AND NOT (d = ANY(sul_sudeste_sem_es))
               THEN 7.00 ELSE 12.00 END
        )
        ON CONFLICT (origin_uf, dest_uf) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ── ICMS interno por UF (alíquota de referência — revisar antes de produção) ───
CREATE TABLE IF NOT EXISTS tax_icms_internal_rates (
  uf    CHAR(2)      PRIMARY KEY,
  rate  NUMERIC(5,2) NOT NULL,
  notes TEXT         NOT NULL DEFAULT 'Valor de referência — confirme com a contabilidade do tenant antes de uso em produção.'
);

INSERT INTO tax_icms_internal_rates (uf, rate) VALUES
  ('AC', 19.00), ('AL', 19.00), ('AP', 18.00), ('AM', 20.00), ('BA', 20.50),
  ('CE', 20.00), ('DF', 20.00), ('ES', 17.00), ('GO', 19.00), ('MA', 22.00),
  ('MT', 17.00), ('MS', 17.00), ('MG', 18.00), ('PA', 19.00), ('PB', 20.00),
  ('PR', 19.50), ('PE', 20.50), ('PI', 21.00), ('RJ', 20.00), ('RN', 18.00),
  ('RS', 17.00), ('RO', 19.50), ('RR', 20.00), ('SC', 17.00), ('SP', 18.00),
  ('SE', 19.00), ('TO', 20.00)
ON CONFLICT (uf) DO NOTHING;

-- ── FCP — Fundo de Combate à Pobreza (estrutura vazia, popular por demanda) ────
CREATE TABLE IF NOT EXISTS tax_fcp_rates (
  uf   CHAR(2)      PRIMARY KEY,
  rate NUMERIC(5,2) NOT NULL
);

-- ── ICMS-ST — regras de Substituição Tributária (estrutura vazia) ─────────────
CREATE TABLE IF NOT EXISTS tax_st_rules (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ncm         VARCHAR(10)   NOT NULL,
  origin_uf   CHAR(2)       NOT NULL,
  dest_uf     CHAR(2)       NOT NULL,
  mva_percent NUMERIC(6,2)  NOT NULL,
  UNIQUE (ncm, origin_uf, dest_uf)
);

CREATE INDEX IF NOT EXISTS idx_tax_st_rules_lookup ON tax_st_rules(ncm, origin_uf, dest_uf);

-- ── Simples Nacional — Anexo I (Comércio), LC 123/2006 pós-reforma 2018 ────────
CREATE TABLE IF NOT EXISTS tax_simples_nacional_brackets (
  anexo            CHAR(1)       NOT NULL DEFAULT 'I',
  faixa            SMALLINT      NOT NULL,
  rbt12_min        NUMERIC(15,2) NOT NULL,
  rbt12_max        NUMERIC(15,2) NOT NULL,
  aliquota_nominal NUMERIC(5,2)  NOT NULL,
  parcela_deduzir  NUMERIC(15,2) NOT NULL,
  PRIMARY KEY (anexo, faixa)
);

INSERT INTO tax_simples_nacional_brackets (anexo, faixa, rbt12_min, rbt12_max, aliquota_nominal, parcela_deduzir) VALUES
  ('I', 1,        0.00,    180000.00,  4.00,      0.00),
  ('I', 2,   180000.01,    360000.00,  7.30,   5940.00),
  ('I', 3,   360000.01,    720000.00,  9.50,  13860.00),
  ('I', 4,   720000.01,  1800000.00, 10.70,  22500.00),
  ('I', 5,  1800000.01,  3600000.00, 14.30,  87300.00),
  ('I', 6,  3600000.01,  4800000.00, 19.00, 378000.00)
ON CONFLICT (anexo, faixa) DO NOTHING;

-- ── Campos adicionais para suportar Simples Nacional, FCP e DIFAL ──────────────
ALTER TABLE tenants       ADD COLUMN IF NOT EXISTS simples_rbt12 NUMERIC(15,2);
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS fcp_total          NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS icms_difal_total   NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS fcp_rate           NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS fcp_value          NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS icms_difal_value   NUMERIC(15,2) NOT NULL DEFAULT 0;
