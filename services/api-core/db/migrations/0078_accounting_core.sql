-- Migration 0078: Motor contábil de DUPLA ENTRADA (módulo 'contabil').
--
-- chart_of_accounts: plano BR simplificado (seed global tenant NULL; custom
-- por tenant sobrepõe via system_key). journal_entries/lines: partidas
-- dobradas com SUM(D)=SUM(C) garantido no domínio puro; posting IDEMPOTENTE
-- por UNIQUE(source_type,source_id); estorno via entry 'reversal' — NUNCA
-- delete (razão é append-only). Correções do Simples embutidas nas posting
-- rules (código): ISS do optante está DENTRO do DAS (nota não lança ISS a
-- recolher; só ISS retido na fonte vira ativo compensável e reduz Clientes);
-- DAS lança na competência da APURAÇÃO; CPP Anexo IV e ICMS/ISS de sublimite
-- ficam FORA do DAS (contas próprias p/ lançamento manual). NÃO substitui
-- ECD/SPED Contábil.

CREATE TABLE chart_of_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = plano global (seed)
  code           VARCHAR(20)  NOT NULL,                          -- hierárquico: 1.1.01
  name           VARCHAR(120) NOT NULL,
  nature         VARCHAR(10)  NOT NULL CHECK (nature IN ('ativo','passivo','pl','receita','despesa')),
  normal_balance VARCHAR(6)   NOT NULL CHECK (normal_balance IN ('debit','credit')),
  is_postable    BOOLEAN      NOT NULL DEFAULT true,             -- sintética (agrupadora) = false
  system_key     VARCHAR(40),                                    -- chave estável p/ posting rules
  dre_category_code VARCHAR(30),                                 -- de-para com dre_categories (0042)
  is_active      BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX uq_coa_code ON chart_of_accounts (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
CREATE UNIQUE INDEX uq_coa_system_key ON chart_of_accounts (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), system_key)
  WHERE system_key IS NOT NULL;

CREATE TABLE journal_entries (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id           UUID REFERENCES nfe_configs(id) ON DELETE SET NULL, -- NULL = fato tenant-level
  entry_date           DATE NOT NULL,
  competencia          CHAR(7) NOT NULL,
  source_type          VARCHAR(30) NOT NULL CHECK (source_type IN (
                         'invoice_authorized','nfse_authorized','receivable_payment',
                         'payable_payment','das_payment','pos_cash_movement',
                         'manual','opening_balance','reversal')),
  source_id            UUID,
  description          VARCHAR(200) NOT NULL,
  reversed_by_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  posted_by            UUID REFERENCES users(id) ON DELETE SET NULL,      -- NULL = sistema
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Posting idempotente: o MESMO fato nunca lança 2× (SQS redelivery, backfill).
CREATE UNIQUE INDEX uq_journal_source ON journal_entries (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX idx_journal_competencia ON journal_entries (tenant_id, competencia);
CREATE INDEX idx_journal_date ON journal_entries (tenant_id, entry_date);

CREATE TABLE journal_lines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id   UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  side       VARCHAR(6) NOT NULL CHECK (side IN ('debit','credit')),
  amount     NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  line_order SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_journal_lines_account ON journal_lines (tenant_id, account_id, entry_id);

-- ── Seed do plano de contas BR simplificado (global, tenant NULL) ────────────
INSERT INTO chart_of_accounts (code, name, nature, normal_balance, is_postable, system_key, dre_category_code) VALUES
  ('1',      'ATIVO',                          'ativo',   'debit',  false, NULL, NULL),
  ('1.1',    'Ativo Circulante',               'ativo',   'debit',  false, NULL, NULL),
  ('1.1.01', 'Caixa',                          'ativo',   'debit',  true,  'caixa', NULL),
  ('1.1.02', 'Bancos',                         'ativo',   'debit',  true,  'bancos', NULL),
  ('1.1.03', 'Clientes',                       'ativo',   'debit',  true,  'clientes', NULL),
  ('1.1.04', 'Estoques',                       'ativo',   'debit',  true,  'estoques', NULL),
  ('1.1.05', 'Impostos Retidos a Compensar',   'ativo',   'debit',  true,  'impostos_retidos', NULL),
  ('2',      'PASSIVO',                        'passivo', 'credit', false, NULL, NULL),
  ('2.1',    'Passivo Circulante',             'passivo', 'credit', false, NULL, NULL),
  ('2.1.01', 'Fornecedores',                   'passivo', 'credit', true,  'fornecedores', NULL),
  ('2.1.02', 'Simples Nacional a Recolher',    'passivo', 'credit', true,  'simples_a_recolher', NULL),
  ('2.1.03', 'Obrigações Trabalhistas',        'passivo', 'credit', true,  'obrigacoes_trabalhistas', NULL),
  ('3',      'PATRIMÔNIO LÍQUIDO',             'pl',      'credit', false, NULL, NULL),
  ('3.1',    'Capital Social',                 'pl',      'credit', true,  'capital_social', NULL),
  ('3.2',    'Lucros/Prejuízos Acumulados',    'pl',      'credit', true,  'lucros_acumulados', NULL),
  ('4',      'RECEITAS',                       'receita', 'credit', false, NULL, NULL),
  ('4.1.01', 'Receita de Vendas',              'receita', 'credit', true,  'receita_vendas', 'receita_bruta'),
  ('4.1.02', 'Receita de Serviços',            'receita', 'credit', true,  'receita_servicos', 'receita_bruta'),
  ('4.2.01', 'Receitas Financeiras',           'receita', 'credit', true,  'receita_financeira', 'receita_financeira'),
  ('5',      'DESPESAS',                       'despesa', 'debit',  false, NULL, NULL),
  ('5.1.01', 'Simples Nacional (DAS)',         'despesa', 'debit',  true,  'despesa_simples', 'tributaria'),
  ('5.1.02', 'INSS Patronal (CPP — Anexo IV, fora do DAS)', 'despesa', 'debit', true, 'cpp_por_fora', 'tributaria'),
  ('5.1.03', 'ICMS/ISS Sublimite (fora do DAS)', 'despesa', 'debit', true, 'sublimite_por_fora', 'tributaria'),
  ('5.2.01', 'CMV/CSP',                        'despesa', 'debit',  true,  'cmv', 'cmv'),
  ('5.2.02', 'Despesas com Pessoal',           'despesa', 'debit',  true,  'despesa_pessoal', 'pessoal'),
  ('5.2.03', 'Aluguel e Condomínio',           'despesa', 'debit',  true,  'despesa_aluguel', 'aluguel'),
  ('5.2.04', 'Utilidades (água/luz/telecom)',  'despesa', 'debit',  true,  'despesa_utilidades', 'utilidades'),
  ('5.2.05', 'Marketing e Vendas',             'despesa', 'debit',  true,  'despesa_marketing', 'marketing'),
  ('5.2.06', 'Administrativas',                'despesa', 'debit',  true,  'despesa_admin', 'admin'),
  ('5.2.07', 'Tributárias (outras)',           'despesa', 'debit',  true,  'despesa_tributaria', 'tributaria'),
  ('5.2.08', 'Despesas Financeiras',           'despesa', 'debit',  true,  'despesa_financeira', 'despesa_financeira'),
  ('5.2.99', 'Outras Despesas',                'despesa', 'debit',  true,  'despesa_outras', 'outras_despesas')
ON CONFLICT DO NOTHING;
