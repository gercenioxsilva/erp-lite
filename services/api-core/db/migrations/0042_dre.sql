-- P3 — DRE Gerencial (Demonstrativo de Resultado do Exercício)
-- Abordagem Caminho A: leitura de dados existentes (invoices/payables) sem dupla entrada.
-- dre_categories: categorias padrão da DRE gerencial (imutáveis após seed).
-- payables.dre_category_id: chave opcional para classificar cada conta a pagar na DRE.
--
-- IMPORTANTE: Este é um DRE GERENCIAL, não contábil. Não substitui escrituração
-- contábil formal (SPED Contábil/ECD). Serve para visão de resultado pelo gestor.

CREATE TABLE IF NOT EXISTS dre_categories (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          REFERENCES tenants(id) ON DELETE CASCADE,   -- NULL = categoria global (seed)
  code         VARCHAR(30)   NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  type         VARCHAR(30)   NOT NULL,  -- revenue | cogs | gross_profit | opex | ebitda | financial | ebt | taxes | net
  sign         SMALLINT      NOT NULL DEFAULT -1,  -- 1 = soma (receita), -1 = subtrai (despesa)
  sort_order   SMALLINT      NOT NULL DEFAULT 0,
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code),
  CONSTRAINT chk_dre_type CHECK (type IN ('revenue', 'deduction', 'cogs', 'opex', 'financial_expense', 'financial_income', 'taxes', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_dre_cat_tenant ON dre_categories(tenant_id, sort_order);

-- Categorias globais da DRE Gerencial Brasileira (padrão CFC — tenant_id NULL = disponível para todos)
INSERT INTO dre_categories (id, tenant_id, code, name, type, sign, sort_order) VALUES
  (gen_random_uuid(), NULL, 'receita_bruta',       'Receita Bruta de Vendas e Serviços',        'revenue',          1,   10),
  (gen_random_uuid(), NULL, 'deducoes',             'Deduções da Receita Bruta',                 'deduction',       -1,   20),
  (gen_random_uuid(), NULL, 'cmv',                  'Custo das Mercadorias Vendidas (CMV)',       'cogs',            -1,   30),
  (gen_random_uuid(), NULL, 'csp',                  'Custo dos Serviços Prestados (CSP)',         'cogs',            -1,   35),
  (gen_random_uuid(), NULL, 'pessoal',              'Despesas com Pessoal',                       'opex',            -1,   40),
  (gen_random_uuid(), NULL, 'aluguel',              'Aluguéis e Condomínio',                      'opex',            -1,   50),
  (gen_random_uuid(), NULL, 'utilidades',           'Utilidades (Energia, Água, Internet, Tel)',  'opex',            -1,   60),
  (gen_random_uuid(), NULL, 'marketing',            'Marketing e Publicidade',                    'opex',            -1,   70),
  (gen_random_uuid(), NULL, 'admin',                'Despesas Administrativas',                   'opex',            -1,   80),
  (gen_random_uuid(), NULL, 'tributaria',           'Despesas Tributárias',                       'opex',            -1,   90),
  (gen_random_uuid(), NULL, 'outras_despesas',      'Outras Despesas Operacionais',               'other',           -1,  100),
  (gen_random_uuid(), NULL, 'despesa_financeira',   'Despesas Financeiras',                       'financial_expense', -1, 110),
  (gen_random_uuid(), NULL, 'receita_financeira',   'Receitas Financeiras',                       'financial_income',  1,  115),
  (gen_random_uuid(), NULL, 'irpj_csll',            'IRPJ e CSLL',                                'taxes',           -1,  120)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Adiciona FK opcional de categoria DRE em payables (aditivo, não quebra dados existentes)
ALTER TABLE payables ADD COLUMN IF NOT EXISTS dre_category_id UUID REFERENCES dre_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payables_dre_cat ON payables(dre_category_id) WHERE dre_category_id IS NOT NULL;
