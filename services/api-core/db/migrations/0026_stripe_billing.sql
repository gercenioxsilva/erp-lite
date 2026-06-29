-- 0026_stripe_billing.sql
-- Adds Stripe subscription billing columns to tenants and creates plans/billing_events tables.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_price_id         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS plans (
  id                VARCHAR(50)    PRIMARY KEY,
  name              VARCHAR(100)   NOT NULL,
  stripe_price_id   VARCHAR(100)   NOT NULL DEFAULT 'price_placeholder',
  price_monthly     NUMERIC(10,2)  NOT NULL,
  max_users         SMALLINT,
  max_nfe_per_month INTEGER,
  max_clients       INTEGER,
  features          JSONB          NOT NULL DEFAULT '{}',
  display_order     SMALLINT       NOT NULL DEFAULT 0,
  is_active         BOOLEAN        NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS billing_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_event_id VARCHAR(100)  NOT NULL UNIQUE,
  event_type      VARCHAR(100)  NOT NULL,
  payload         JSONB         NOT NULL,
  processed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO plans (id, name, stripe_price_id, price_monthly, max_users, max_nfe_per_month, max_clients, features, display_order)
VALUES
  ('starter',    'Starter',      'price_placeholder_starter',    97.00,  3,    100,  200,  '{"reports":false,"api_access":false}', 1),
  ('pro',        'Profissional', 'price_placeholder_pro',       197.00,  10,   500,  NULL, '{"reports":true,"api_access":false}',  2),
  ('enterprise', 'Enterprise',  'price_placeholder_enterprise', 397.00,  NULL, NULL, NULL, '{"reports":true,"api_access":true}',   3)
ON CONFLICT (id) DO NOTHING;
