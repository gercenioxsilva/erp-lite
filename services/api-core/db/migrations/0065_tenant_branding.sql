-- Perfis de Segmento + Branding por tenant (regra correspondente no README).
-- O tenant escolhe um SEGMENTO no onboarding (barbearia, autoescola,
-- compressores…) e o sistema aplica um preset de labels/cores/logo. As labels
-- e a paleta-padrão de cada segmento vivem em CÓDIGO (catálogo versionável no
-- frontend, mesmo racional do CATALOG_SPEC do RBAC) — aqui só persistimos a
-- ESCOLHA do segmento e os OVERRIDES manuais de cor que o cliente fizer por
-- cima em Minha Empresa. Logo continua em tenants.logo_url (já existe).
--
-- brand_primary/brand_accent são hex '#RRGGBB' (NULL = usar a cor do preset do
-- segmento). segment_key NULL = 'generic' (tratado no código; não forçamos
-- default no banco para distinguir "nunca escolheu" de "escolheu genérico").

ALTER TABLE tenants ADD COLUMN segment_key   varchar(40);
ALTER TABLE tenants ADD COLUMN brand_primary varchar(9);
ALTER TABLE tenants ADD COLUMN brand_accent  varchar(9);
