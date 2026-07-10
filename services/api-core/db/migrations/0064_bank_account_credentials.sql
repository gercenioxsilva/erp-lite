-- Migration 0064: Credenciais genéricas por provedor de cobrança (regra 41 + nova regra de Boleto C6)
-- Prepara bank_accounts para o 2º banco de verdade (C6, FEBRABAN 336). Hoje as
-- credenciais são colunas nomeadas por banco (itau_client_id/itau_client_secret)
-- — C6 exige, além de client_id/client_secret, um certificado com chave
-- privada (par .crt/.key, mTLS), que não cabe nesse modelo sem outra rodada de
-- colunas soltas. Em vez de repetir o padrão (e travar o 3º banco, já
-- cogitado no enum billing_provider: santander/bradesco), esta migration
-- introduz UMA coluna genérica que serve qualquer provedor.
--
-- Backfill obrigatório: toda linha com itau_client_id/itau_client_secret já
-- preenchidos ganha o equivalente em `credentials` — nenhuma conta perde
-- acesso às próprias credenciais.
--
-- itau_client_id/itau_client_secret continuam existindo (sem DROP
-- destrutivo, mesmo espírito não-destrutivo da regra 41) mas passam a ser
-- deprecated-mas-presentes: a partir desta migration, nenhuma rota escreve
-- diretamente nelas — todo provedor (Itaú incluso, retroativamente) passa a
-- ler/escrever via `credentials`.

ALTER TABLE bank_accounts ADD COLUMN credentials JSONB;

UPDATE bank_accounts
SET credentials = jsonb_build_object('client_id', itau_client_id, 'client_secret', itau_client_secret)
WHERE itau_client_id IS NOT NULL OR itau_client_secret IS NOT NULL;
