-- Discrimina contratos de serviço recorrente ('service', o padrão de sempre)
-- de contratos de locação ('rental') — só locação oferece a emissão da Nota
-- de Locação / Recibo / Fatura (documento sem valor fiscal) por cobrança.
ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'service';
ALTER TABLE service_contracts DROP CONSTRAINT IF EXISTS chk_service_contracts_type;
ALTER TABLE service_contracts ADD CONSTRAINT chk_service_contracts_type CHECK (type IN ('service', 'rental'));

-- Contato responsável pelo contrato do lado do cliente (ex.: "Mariana" na
-- nota de locação) — não existe em `clients` (cadastro é da empresa/pessoa,
-- não de um contato específico dentro dela).
ALTER TABLE service_contracts ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);

-- Numeração sequencial própria do documento de recibo/fatura (distinta de
-- service_contracts.contract_number) — gerada em toda cobrança, usada só
-- quando o contrato é do tipo 'rental'.
ALTER TABLE contract_billings ADD COLUMN IF NOT EXISTS document_number VARCHAR(20);
