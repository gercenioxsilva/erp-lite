ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS itau_client_id     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS itau_client_secret VARCHAR(255);
