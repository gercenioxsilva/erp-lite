-- Ativação de Conta por E-mail (regra correspondente no README) — hoje
-- POST /v1/auth/register devolve um JWT válido sem nunca confirmar que o
-- e-mail cadastrado existe/pertence a quem se cadastrou. A partir desta
-- migration, o tenant só usa o sistema de fato depois que o owner confirmar
-- o e-mail (tenants.activated_at preenchido) — enforced por
-- tenantActivationGuard.ts (hook global, irmão de subscriptionGuard.ts).
--
-- tenants.activated_at — portão real, no agregado Tenant (é uma decisão
-- sobre a CONTA). users.email_verification_token/expires/verified_at são
-- colunas NOVAS e DEDICADAS — nunca reaproveitam password_reset_token
-- (domínios de segurança diferentes: trocar senha vs. confirmar identidade;
-- reaproveitar a mesma coluna criaria risco de colisão entre os dois fluxos).
--
-- BACKFILL OBRIGATÓRIO: todo tenant que já existe hoje é considerado
-- ativado automaticamente — sem isso, o deploy trancaria todo cliente já em
-- produção. Não é opcional.

ALTER TABLE tenants ADD COLUMN activated_at timestamptz;

ALTER TABLE users ADD COLUMN email_verification_token   varchar(255);
ALTER TABLE users ADD COLUMN email_verification_expires timestamptz;
ALTER TABLE users ADD COLUMN email_verified_at          timestamptz;

UPDATE tenants SET activated_at = created_at WHERE activated_at IS NULL;
