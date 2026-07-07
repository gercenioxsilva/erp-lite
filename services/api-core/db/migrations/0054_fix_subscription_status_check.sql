-- 0049_fix_subscription_status_check.sql
-- Fixes a drift between the original tenants CHECK constraints (0001_tenants.sql,
-- status IN ('trial','active','suspended','cancelled') / plan IN ('starter','professional','enterprise'))
-- and the vocabulary the Stripe webhook handler (routes/subscription.ts) actually writes
-- (status 'past_due'/'canceled', plan id 'pro' from the plans table seeded in 0026_stripe_billing.sql).
-- Every past_due/canceled webhook event, and any Profissional-tier subscription event,
-- was failing with a Postgres 23514 constraint violation and being silently dropped.
--
-- Direction: align tenants.status/plan to the Stripe-code convention ('canceled' single-L,
-- 'pro'), not the reverse — 'cancelled' (double-L) stays the correct spelling for every
-- OTHER table's status column (orders, invoices, payables, receivables, purchase_orders, etc).

UPDATE tenants SET status = 'canceled' WHERE status = 'cancelled';
UPDATE tenants SET plan   = 'pro'      WHERE plan   = 'professional';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'canceled'));

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
  CHECK (plan IN ('starter', 'pro', 'enterprise'));
