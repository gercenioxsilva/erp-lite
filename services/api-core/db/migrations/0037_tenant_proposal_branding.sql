-- 0037_tenant_proposal_branding.sql
-- Branding da proposta pública por tenant:
--   state_reg            → Inscrição Estadual (IE) exibida no rodapé da proposta
--   proposal_banner_url  → imagem (banner) de topo da proposta (data URI base64)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS state_reg           varchar(30),
  ADD COLUMN IF NOT EXISTS proposal_banner_url text;
