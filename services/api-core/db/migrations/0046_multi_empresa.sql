-- Migration 0046: Multi-Empresa (Multi-CNPJ)
-- nfe_configs deixa de ser um singleton por tenant (tenant_id era a PRIMARY KEY)
-- e passa a suportar N linhas por tenant — cada linha é uma "empresa" (CNPJ)
-- que o tenant opera. A criação de uma 2ª+ empresa é gateada pelo módulo
-- opcional 'multi_empresa' (tenant_modules) — ver regra 40 do README.
--
-- Nenhum outro código tem FK para nfe_configs, então trocar a PK é seguro,
-- sem quebra em cascata. Toda linha existente já é, por definição, a empresa
-- padrão (is_default=true) do seu tenant — nenhuma migração de dado é
-- necessária além disso.

ALTER TABLE nfe_configs ADD COLUMN id UUID DEFAULT gen_random_uuid();
UPDATE nfe_configs SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE nfe_configs ALTER COLUMN id SET NOT NULL;
ALTER TABLE nfe_configs DROP CONSTRAINT nfe_configs_pkey;
ALTER TABLE nfe_configs ADD PRIMARY KEY (id);

ALTER TABLE nfe_configs ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE nfe_configs ADD COLUMN is_active  BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX uq_nfe_configs_tenant_cnpj ON nfe_configs(tenant_id, cnpj);
CREATE UNIQUE INDEX uq_nfe_configs_one_default ON nfe_configs(tenant_id) WHERE is_default = true;

-- Fan-out para os pontos de emissão fiscal (nullable, aditivo — mesmo padrão
-- de seller_id/cost_center_id nas migrations 0026/0027/0036). Fora do escopo
-- desta fase: payables, purchase_orders, supplier_invoices, receivables,
-- proposals, orders, boleto/Itaú (continuam 1:1 por tenant) — ver regra 40.
ALTER TABLE invoices          ADD COLUMN company_id UUID REFERENCES nfe_configs(id) ON DELETE SET NULL;
ALTER TABLE nfse_invoices     ADD COLUMN company_id UUID REFERENCES nfe_configs(id) ON DELETE SET NULL;
ALTER TABLE service_contracts ADD COLUMN company_id UUID REFERENCES nfe_configs(id) ON DELETE SET NULL;

-- Backfill imediato — nenhuma linha histórica fica com company_id NULL.
UPDATE invoices i SET company_id = c.id
  FROM nfe_configs c WHERE c.tenant_id = i.tenant_id AND c.is_default;
UPDATE nfse_invoices n SET company_id = c.id
  FROM nfe_configs c WHERE c.tenant_id = n.tenant_id AND c.is_default;
UPDATE service_contracts sc SET company_id = c.id
  FROM nfe_configs c WHERE c.tenant_id = sc.tenant_id AND c.is_default;
