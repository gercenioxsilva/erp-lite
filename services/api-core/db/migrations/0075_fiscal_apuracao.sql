-- Migration 0075: Módulo Fiscal — apuração PGDAS-D (Simples Nacional).
--
-- 1) simples_apuracao: agregado mensal por empresa/competência (idempotente
--    por UNIQUE) com a MEMÓRIA DE CÁLCULO completa (todos os valores exatos
--    que iriam no PGDAS-D). SEM transmissão oficial — o portal GOV.BR é
--    manual; o sistema entrega memória + export + roteiro assistido.
-- 2) das_payments: tributo PAGO (dashboard "estimado vs pago") — alimentado
--    manualmente ou pela conciliação (débito de DAS no extrato OFX).
-- 3) Seed de tax_simples_repartition (percentual de repartição por tributo,
--    LC 123/2006 pós-LC 155/2016, vigência 2018+). DADO PARAMETRIZÁVEL:
--    atualização anual entra por INSERT com nova vigência, sem deploy.
--    Anexo IV NÃO tem CPP (INSS patronal recolhido por fora, via GPS).

CREATE TABLE simples_apuracao (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia       CHAR(7) NOT NULL,                 -- 'YYYY-MM'
  rbt12             NUMERIC(15,2) NOT NULL,
  rbt12_source      VARCHAR(10) NOT NULL DEFAULT 'ledger' CHECK (rbt12_source IN ('ledger','manual')),
  receita_competencia NUMERIC(15,2) NOT NULL,
  fator_r           NUMERIC(6,4),
  sublimite_excedido BOOLEAN NOT NULL DEFAULT false,  -- ICMS/ISS por fora
  das_total         NUMERIC(15,2) NOT NULL,
  valor_irpj        NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_csll        NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_cofins      NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_pis         NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_cpp         NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_icms        NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_ipi         NUMERIC(15,2) NOT NULL DEFAULT 0,
  valor_iss         NUMERIC(15,2) NOT NULL DEFAULT 0,
  iss_retido        NUMERIC(15,2) NOT NULL DEFAULT 0, -- abatido do DAS (retenção pelo tomador)
  memoria           JSONB NOT NULL,                   -- memória de cálculo completa (por anexo/faixa)
  status            VARCHAR(14) NOT NULL DEFAULT 'calculated'
                    CHECK (status IN ('calculated','exported','filed_manual')),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_simples_apuracao ON simples_apuracao (tenant_id, company_id, competencia);

CREATE TABLE simples_apuracao_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  apuracao_id UUID NOT NULL REFERENCES simples_apuracao(id) ON DELETE CASCADE,
  event_type  VARCHAR(30) NOT NULL,  -- calculated|recalculated|exported|filed_manual
  payload     JSONB,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE das_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  competencia  CHAR(7) NOT NULL,
  paid_at      DATE NOT NULL,
  amount       NUMERIC(15,2) NOT NULL,
  source       VARCHAR(14) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','reconciliation')),
  reference    VARCHAR(100),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, company_id, competencia, paid_at, amount)
);

-- ── Repartição oficial LC123 (percentual de cada tributo na alíquota efetiva)
-- Anexo I (Comércio): IRPJ/CSLL/COFINS/PIS/CPP/ICMS — faixa 6 sem ICMS.
INSERT INTO tax_simples_repartition (vigencia_ano, anexo, faixa, irpj, csll, cofins, pis, cpp, icms, ipi, iss) VALUES
  (2018,'I',1, 5.50, 3.50,12.74, 2.76,41.50,34.00, 0, 0),
  (2018,'I',2, 5.50, 3.50,12.74, 2.76,41.50,34.00, 0, 0),
  (2018,'I',3, 5.50, 3.50,12.74, 2.76,42.00,33.50, 0, 0),
  (2018,'I',4, 5.50, 3.50,12.74, 2.76,42.00,33.50, 0, 0),
  (2018,'I',5, 5.50, 3.50,12.74, 2.76,42.00,33.50, 0, 0),
  (2018,'I',6,13.50,10.00,28.27, 6.13,42.10, 0.00, 0, 0),
-- Anexo II (Indústria): + IPI; faixa 6 sem ICMS.
  (2018,'II',1, 5.50, 3.50,11.51, 2.49,37.50,32.00, 7.50, 0),
  (2018,'II',2, 5.50, 3.50,11.51, 2.49,37.50,32.00, 7.50, 0),
  (2018,'II',3, 5.50, 3.50,11.51, 2.49,37.50,32.00, 7.50, 0),
  (2018,'II',4, 5.50, 3.50,11.51, 2.49,37.50,32.00, 7.50, 0),
  (2018,'II',5, 5.50, 3.50,11.51, 2.49,37.50,32.00, 7.50, 0),
  (2018,'II',6, 8.50, 7.50,20.96, 4.54,23.50, 0.00,35.00, 0),
-- Anexo III (Serviços §5-B): ISS; faixa 6 sem ISS.
  (2018,'III',1, 4.00, 3.50,12.82, 2.78,43.40, 0, 0,33.50),
  (2018,'III',2, 4.00, 3.50,14.05, 3.05,43.40, 0, 0,32.00),
  (2018,'III',3, 4.00, 3.50,13.64, 2.96,43.40, 0, 0,32.50),
  (2018,'III',4, 4.00, 3.50,13.64, 2.96,43.40, 0, 0,32.50),
  (2018,'III',5, 4.00, 3.50,12.82, 2.78,43.40, 0, 0,33.50),
  (2018,'III',6,35.00,15.00,16.03, 3.47,30.50, 0, 0, 0.00),
-- Anexo IV (§5-C): SEM CPP (INSS patronal por fora via GPS); faixa 6 sem ISS.
  (2018,'IV',1,18.80,15.20,17.67, 3.83, 0, 0, 0,44.50),
  (2018,'IV',2,19.80,15.20,20.55, 4.45, 0, 0, 0,40.00),
  (2018,'IV',3,20.80,15.20,19.73, 4.27, 0, 0, 0,40.00),
  (2018,'IV',4,17.80,19.20,18.90, 4.10, 0, 0, 0,40.00),
  (2018,'IV',5,18.80,19.20,18.08, 3.92, 0, 0, 0,40.00),
  (2018,'IV',6,53.50,21.50,20.55, 4.45, 0, 0, 0, 0.00),
-- Anexo V (§5-I): faixa 6 sem ISS.
  (2018,'V',1,25.00,15.00,14.10, 3.05,28.85, 0, 0,14.00),
  (2018,'V',2,23.00,15.00,14.10, 3.05,27.85, 0, 0,17.00),
  (2018,'V',3,24.00,15.00,14.92, 3.23,23.85, 0, 0,19.00),
  (2018,'V',4,21.00,15.00,15.74, 3.41,23.85, 0, 0,21.00),
  (2018,'V',5,23.00,12.50,14.10, 3.05,23.85, 0, 0,23.50),
  (2018,'V',6,35.00,15.50,16.44, 3.56,29.50, 0, 0, 0.00)
ON CONFLICT (vigencia_ano, anexo, faixa) DO NOTHING;
