-- Per-tenant notification settings.
-- One row per tenant; created on first PATCH/PUT via the API.
-- All toggles default to true except order_confirmed (avoids spam on busy tenants).

CREATE TABLE IF NOT EXISTS notification_configs (
  tenant_id              UUID          PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  email_enabled          BOOLEAN       NOT NULL DEFAULT true,
  email_from_name        VARCHAR(100)  NOT NULL DEFAULT 'GAX ERP',
  email_reply_to         VARCHAR(255),
  notify_nfe_authorized  BOOLEAN       NOT NULL DEFAULT true,
  notify_nfe_rejected    BOOLEAN       NOT NULL DEFAULT true,
  notify_order_confirmed BOOLEAN       NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER notification_configs_updated_at
  BEFORE UPDATE ON notification_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
