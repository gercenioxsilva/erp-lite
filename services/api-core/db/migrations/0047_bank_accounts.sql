-- Migration 0047: Múltiplas Contas Bancárias por Empresa
-- Hoje um tenant tem exatamente uma conta bancária (colunas soltas em tenants:
-- bank_code, agency, account, account_digit, billing_provider,
-- billing_days_to_expire, itau_client_id, itau_client_secret). Esta migration
-- promove isso para N contas por EMPRESA (nfe_configs) — mesma cirurgia já
-- feita em nfe_configs na migration 0046, agora um nível abaixo.
--
-- Sem gate de módulo (diferente de multi_empresa): mesmo um tenant com 1 CNPJ
-- só pode querer 2 contas bancárias para aquele CNPJ.

CREATE TABLE bank_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  company_id             UUID NOT NULL REFERENCES nfe_configs(id) ON DELETE CASCADE,
  label                  VARCHAR(100),
  bank_code              VARCHAR(3)   NOT NULL,
  agency                 VARCHAR(10)  NOT NULL,
  account                VARCHAR(20)  NOT NULL,
  account_digit          VARCHAR(2)   NOT NULL,
  billing_provider       VARCHAR(30)  NOT NULL DEFAULT 'brcode',
  billing_days_to_expire INTEGER      NOT NULL DEFAULT 30,
  itau_client_id         VARCHAR(100),
  itau_client_secret     VARCHAR(255),
  is_default             BOOLEAN      NOT NULL DEFAULT true,
  is_active              BOOLEAN      NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_accounts_tenant  ON bank_accounts(tenant_id);
CREATE INDEX idx_bank_accounts_company ON bank_accounts(company_id, is_active);
CREATE UNIQUE INDEX uq_bank_accounts_one_default_per_company ON bank_accounts(company_id) WHERE is_default = true;

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill: todo tenant com dados bancários já preenchidos ganha 1 conta
-- vinculada à sua empresa padrão (nfe_configs sempre tem exatamente 1
-- is_default=true por tenant, garantido pela migration 0046) — nenhum tenant
-- que já tinha conta bancária fica sem ela pós-migração.
INSERT INTO bank_accounts (tenant_id, company_id, bank_code, agency, account, account_digit,
                            billing_provider, billing_days_to_expire, itau_client_id, itau_client_secret,
                            is_default, is_active)
SELECT t.id, c.id, t.bank_code, t.agency, t.account, t.account_digit,
       COALESCE(t.billing_provider, 'brcode'), COALESCE(t.billing_days_to_expire, 30),
       t.itau_client_id, t.itau_client_secret, true, true
FROM tenants t
JOIN nfe_configs c ON c.tenant_id = t.id AND c.is_default = true
WHERE t.bank_code IS NOT NULL AND t.agency IS NOT NULL AND t.account IS NOT NULL AND t.account_digit IS NOT NULL;

-- Fan-out: qual conta emitiu este boleto (nullable, aditivo). O snapshot em
-- boletos.banco_code/agencia/conta/digito continua existindo sem mudança —
-- isso é só rastreabilidade extra para saber qual bank_account foi a origem.
ALTER TABLE boletos ADD COLUMN bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL;
