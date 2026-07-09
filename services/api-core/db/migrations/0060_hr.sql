-- Módulo de RH Simplificado (regra correspondente no README) — módulo
-- opcional, desligado por padrão (mesmo mecanismo genérico de tenant_modules
-- já usado por Ordens de Serviço/Funil de Vendas/Mercado Livre/PDV).
--
-- ESCOPO DELIBERADO: ferramenta de cálculo/organização interna — cadastro de
-- funcionários + folha de pagamento calculada (INSS/IRRF/FGTS/provisões).
-- NUNCA envia nada ao eSocial (obrigatório pra empresas com 2+ funcionários,
-- exige certificado digital — fora de escopo). O contador do tenant continua
-- responsável pela submissão oficial; este módulo só organiza os números.
--
-- Modelo: employees (cadastro) → payroll_runs (folha do mês, status
-- draft→closed irreversível) → payroll_entries (holerite por funcionário,
-- snapshot calculado no momento da geração). payroll_tax_brackets é uma
-- tabela GLOBAL (não tenant-scoped — INSS/IRRF são federais, iguais pra todo
-- mundo), mesmo racional de tax_simples_nacional_brackets no motor fiscal —
-- precisa de atualização manual quando a lei muda.

CREATE TABLE employees (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id       uuid REFERENCES nfe_configs(id) ON DELETE SET NULL,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  name             varchar(255) NOT NULL,
  cpf              varchar(11) NOT NULL,
  email            varchar(255),
  phone            varchar(30),
  role_title       varchar(120),
  regime           varchar(20) NOT NULL DEFAULT 'clt',
  base_salary      decimal(15,2) NOT NULL DEFAULT 0,
  cost_center_id   uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  hire_date        date NOT NULL,
  termination_date date,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_regime_check CHECK (regime IN ('clt', 'pro_labore')),
  CONSTRAINT uq_employees_tenant_cpf UNIQUE (tenant_id, cpf)
);

CREATE INDEX idx_employees_tenant ON employees(tenant_id);

CREATE TABLE payroll_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id            uuid REFERENCES nfe_configs(id) ON DELETE SET NULL,
  reference_month       date NOT NULL,
  status                varchar(20) NOT NULL DEFAULT 'draft',
  gross_total           decimal(15,2) NOT NULL DEFAULT 0,
  deductions_total       decimal(15,2) NOT NULL DEFAULT 0,
  net_total             decimal(15,2) NOT NULL DEFAULT 0,
  employer_charges_total decimal(15,2) NOT NULL DEFAULT 0,
  closed_at             timestamptz,
  closed_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_status_check CHECK (status IN ('draft', 'closed')),
  CONSTRAINT uq_payroll_runs_month UNIQUE (tenant_id, company_id, reference_month)
);

CREATE INDEX idx_payroll_runs_tenant ON payroll_runs(tenant_id);

CREATE TABLE payroll_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_run_id           uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id              uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name            varchar(255) NOT NULL,
  regime                   varchar(20) NOT NULL,
  base_salary              decimal(15,2) NOT NULL,
  extra_earnings           jsonb NOT NULL DEFAULT '[]',
  extra_deductions         jsonb NOT NULL DEFAULT '[]',
  inss_value               decimal(15,2) NOT NULL DEFAULT 0,
  irrf_value               decimal(15,2) NOT NULL DEFAULT 0,
  fgts_value               decimal(15,2) NOT NULL DEFAULT 0,
  ferias_provisao          decimal(15,2) NOT NULL DEFAULT 0,
  decimo_terceiro_provisao decimal(15,2) NOT NULL DEFAULT 0,
  gross_total              decimal(15,2) NOT NULL DEFAULT 0,
  deductions_total         decimal(15,2) NOT NULL DEFAULT 0,
  net_total                decimal(15,2) NOT NULL DEFAULT 0,
  payable_id               uuid REFERENCES payables(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_entries_regime_check CHECK (regime IN ('clt', 'pro_labore')),
  CONSTRAINT uq_payroll_entries_run_employee UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX idx_payroll_entries_run ON payroll_entries(payroll_run_id);
CREATE INDEX idx_payroll_entries_employee ON payroll_entries(employee_id);

-- Global (não tenant-scoped) — INSS/IRRF são faixas federais, iguais pra
-- todo mundo. Seed com as faixas vigentes em 2026 (salário mínimo R$1.621,
-- teto INSS R$8.475,55, isenção IRRF até R$5.000 — Lei do IR 2026).
CREATE TABLE payroll_tax_brackets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             varchar(10) NOT NULL,
  min_value        decimal(15,2) NOT NULL,
  max_value        decimal(15,2),
  rate             decimal(6,4) NOT NULL,
  deduction_value  decimal(15,2) NOT NULL DEFAULT 0,
  valid_from       date NOT NULL,
  CONSTRAINT payroll_tax_brackets_type_check CHECK (type IN ('inss', 'irrf'))
);

CREATE INDEX idx_payroll_tax_brackets_type ON payroll_tax_brackets(type, valid_from);

-- INSS 2026 (progressivo por faixa, sem parcela a deduzir — cada faixa
-- tributa só a parte do salário que cai nela).
INSERT INTO payroll_tax_brackets (type, min_value, max_value, rate, deduction_value, valid_from) VALUES
  ('inss', 0,       1621.00, 0.075, 0, '2026-01-01'),
  ('inss', 1621.01, 2902.84, 0.09,  0, '2026-01-01'),
  ('inss', 2902.85, 4354.27, 0.12,  0, '2026-01-01'),
  ('inss', 4354.28, 8475.55, 0.14,  0, '2026-01-01');

-- IRRF 2026 — base = salário - INSS. SÓ o primeiro dado abaixo é confirmado:
-- isenção até R$5.000/mês (Lei do IR, vigente desde jan/2026). A faixa de
-- transição oficial (R$5.000,01–R$7.350,00) usa um redutor decrescente cuja
-- fórmula exata NÃO foi confirmada nesta pesquisa — os valores de faixa/
-- dedução abaixo de R$5.000,01 em diante são uma APROXIMAÇÃO (estrutura
-- tradicional da tabela do IR escalada pro novo teto de isenção), não a lei
-- oficial. MESMA RESSALVA já aplicada aos defaults fiscais de Simples
-- Remessa (regra 51 do README): precisa de validação de um contador antes
-- do primeiro uso em produção — nunca tratar como fonte de verdade legal.
INSERT INTO payroll_tax_brackets (type, min_value, max_value, rate, deduction_value, valid_from) VALUES
  ('irrf', 0,       5000.00, 0,     0,      '2026-01-01'),
  ('irrf', 5000.01, 7000.00, 0.15,  750.00, '2026-01-01'),
  ('irrf', 7000.01, NULL,    0.275, 1362.50,'2026-01-01');
