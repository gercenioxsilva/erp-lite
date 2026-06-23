-- Add logo support to tenants.
-- Logo is stored as a base64 data URI (max 300 KB) for zero-infra simplicity.
-- Returned only via GET /v1/tenant — never bundled into auth/me to keep that response small.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT;
