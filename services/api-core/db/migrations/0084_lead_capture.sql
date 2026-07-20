-- Migration 0084: Captação de Leads via API pública (landing pages).
--
-- Generaliza a infraestrutura de api_keys (0080, hoje só do Fiscal Engine)
-- com um tipo de chave pensado pra ficar embutida em JS client-side de site
-- estático (padrão Stripe publishable key): key_type distingue 'secret'
-- (nunca deve rodar fora de um backend — é o que o Engine já usa) de
-- 'publishable' (só pode ter o escopo 'leads:create', nunca lê/lista nada,
-- rate limit bem mais baixo por padrão). allowed_origins é defesa em
-- profundidade opcional (checagem de Origin/Referer) — nunca a garantia
-- real, que continua sendo rate limit + validação de campo + dedup no
-- domínio (Origin é forjável fora de um browser de verdade).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_type VARCHAR(12) NOT NULL DEFAULT 'secret';
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS chk_api_keys_key_type;
ALTER TABLE api_keys ADD CONSTRAINT chk_api_keys_key_type CHECK (key_type IN ('secret', 'publishable'));
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_origins JSONB;

-- Origem do registro em clients (mesmo padrão de orders.origin, migration
-- 0006, default 'erp') — 'landing_page' marca o que entrou pela API pública,
-- sem misturar com o restante da carteira sem distinção nenhuma na tela.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'erp';

-- Dedup por e-mail quando não há CNPJ/CPF: hoje só existe UNIQUE(tenant_id,
-- cnpj)/UNIQUE(tenant_id, cpf), e como NULL nunca colide em UNIQUE do
-- Postgres, um lead só com nome/e-mail (o caso mais comum de formulário de
-- landing page) nunca era deduplicado. NÃO adicionamos um índice único novo
-- aqui de propósito — a base já tem dados reais em produção e não há garantia
-- de que dois clientes sem documento e com o mesmo e-mail nunca coexistam
-- hoje (ex.: contato duplicado cadastrado manualmente); um índice único
-- nessas condições poderia falhar a migration. A dedup por e-mail pra lead
-- fica na camada de aplicação (findOrCreateLeadClient, services/api-core/src/
-- services/clientService.ts) — mesmo racional de outras dedups
-- "select-then-decide" já usadas no projeto (ex.: validateNewCompanyCnpj).
-- Um índice único parcial pode ser adicionado depois, sob demanda, se/quando
-- os dados existentes forem auditados e limpos.
