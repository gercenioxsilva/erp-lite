-- CNPJ Alfanumérico — Instrução Normativa RFB nº 2.229/2024
-- A Receita Federal passará a emitir CNPJs alfanuméricos a partir de julho/2026.
-- O sistema já armazenava CNPJ como VARCHAR(14) sem restrição de formato de dígitos,
-- portanto NÃO há alteração de estrutura de tabela necessária.
--
-- Este migration:
--  1. Adiciona comentários às colunas cnpj para documentar o novo formato aceito.
--  2. Cria índice funcional UPPER() para garantir busca case-insensitive consistente.
--     (CNPJs alfanuméricos sempre gravados em maiúsculas pela camada de aplicação.)
--
-- Formato aceito: [A-Z0-9]{12}[0-9]{2} (12 alfanuméricos + 2 dígitos verificadores)
-- Algoritmo DV: Módulo 11, pesos [5,4,3,2,9,8,7,6,5,4,3,2] e [6,5,4,3,2,9,8,7,6,5,4,3,2]
--               com conversão base-36 (A=10 … Z=35, 0-9=0-9). Compatível retroativamente
--               com todos os CNPJs numéricos existentes.
--
-- A aplicação normaliza o CNPJ (remove . - / e converte para maiúsculas) antes de
-- qualquer leitura/gravação — ver cnpjDomain.ts (normalizeCNPJ).

-- Documentação via comentários nas colunas
COMMENT ON COLUMN clients.cnpj           IS 'CNPJ do cliente — numérico (pré-2026) ou alfanumérico (IN RFB 2.229/2024). Armazenado sem máscara, sempre em maiúsculas. VARCHAR(14).';
COMMENT ON COLUMN suppliers.cnpj         IS 'CNPJ do fornecedor — numérico (pré-2026) ou alfanumérico (IN RFB 2.229/2024). Armazenado sem máscara, sempre em maiúsculas. VARCHAR(14).';
COMMENT ON COLUMN nfe_configs.cnpj       IS 'CNPJ do emitente de NF-e — numérico (pré-2026) ou alfanumérico (IN RFB 2.229/2024). Armazenado sem máscara, sempre em maiúsculas. VARCHAR(14).';

-- Índice funcional para busca case-insensitive (CNPJ alfanumérico é sempre maiúsculo
-- no banco, mas queries vindas do usuario podem vir em lowercase)
CREATE INDEX IF NOT EXISTS idx_clients_cnpj_upper
  ON clients (UPPER(cnpj))
  WHERE cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_cnpj_upper
  ON suppliers (UPPER(cnpj))
  WHERE cnpj IS NOT NULL;
