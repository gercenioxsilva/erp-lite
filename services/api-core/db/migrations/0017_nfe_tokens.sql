-- Add per-tenant Focus NF-e tokens to nfe_configs
-- Each tenant can configure separate tokens for homologação and produção environments
-- If not set, Lambda falls back to the shared FOCUS_NFE_TOKEN env var

ALTER TABLE nfe_configs
  ADD COLUMN IF NOT EXISTS focus_token_homologacao VARCHAR(255),
  ADD COLUMN IF NOT EXISTS focus_token_producao    VARCHAR(255);
