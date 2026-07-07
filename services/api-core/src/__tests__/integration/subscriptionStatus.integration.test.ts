import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

// ── Real-Postgres proof of the tenants.status/tenants.plan CHECK-constraint
// fix (migration 0049_fix_subscription_status_check.sql).
//
// This is deliberately NOT using the mocked `db` from '../../db' — a mocked
// db.execute can never surface a Postgres 23514 (check_violation) error,
// which is exactly how the original bug shipped invisibly (every unit test
// for the webhook handler passed while every real webhook silently 500'd).
// This test runs the literal UPDATE statements handleStripeEvent() issues
// (see src/routes/subscription.ts) against a real database and asserts they
// no longer throw — plus a negative check that the legacy vocabulary
// ('cancelled' double-L, 'professional') is now correctly rejected, proving
// the constraint was actually tightened to the new vocabulary rather than
// just dropped.
//
// Requires a reachable Postgres (the same one docker-compose.yml's `db`
// service provides locally on host port 5432 — or CI's `postgres:16-alpine`
// service container, which sets DATABASE_URL explicitly) with migrations
// already applied — run `npm run migrate` (or `migrate:dev`) first.
//
// NOTE: if your local docker-compose.override.yml remaps the `db` service's
// host port (a common pattern for avoiding conflicts with other projects),
// export DATABASE_URL yourself before running this suite rather than relying
// on the default below, which intentionally matches the *committed*
// docker-compose.yml so it works out of the box for every other contributor.

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://erp_lite:erp_lite@localhost:5432/erp_lite';

const pool = new Pool({ connectionString: DATABASE_URL });

async function createTestTenant(): Promise<string> {
  const { rows: [row] } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (company_name, tax_id, tax_id_type)
     VALUES ($1, $2, 'CNPJ')
     RETURNING id`,
    [`Subscription Status Test ${randomUUID()}`, randomUUID().replace(/-/g, '').slice(0, 14)],
  );
  return row.id;
}

describe('tenants.status / tenants.plan CHECK constraints (real DB, migration 0049)', () => {
  let tenantId: string;

  beforeAll(async () => {
    await pool.query('SELECT 1'); // fail fast with a clear error if Postgres is unreachable
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    tenantId = await createTestTenant();
  });

  afterEach(async () => {
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  });

  it('accepts status = past_due (previously violated the original CHECK constraint)', async () => {
    await expect(
      pool.query('UPDATE tenants SET status = $1 WHERE id = $2', ['past_due', tenantId]),
    ).resolves.toBeDefined();
  });

  it('accepts the customer.subscription.deleted statement (status = canceled, single-L)', async () => {
    await expect(
      pool.query(
        `UPDATE tenants SET
           status                 = 'canceled',
           stripe_subscription_id = NULL,
           subscription_period_end = NULL
         WHERE id = $1`,
        [tenantId],
      ),
    ).resolves.toBeDefined();
  });

  it('accepts the invoice.payment_succeeded statement (status = active)', async () => {
    await expect(
      pool.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [tenantId]),
    ).resolves.toBeDefined();
  });

  it('accepts the invoice.payment_failed statement (status = past_due)', async () => {
    await expect(
      pool.query(`UPDATE tenants SET status = 'past_due' WHERE id = $1`, [tenantId]),
    ).resolves.toBeDefined();
  });

  it.each([
    ['starter', 'active'],
    ['pro', 'past_due'],
    ['enterprise', 'canceled'],
  ])('accepts the customer.subscription.created/updated statement for plan=%s status=%s', async (plan, status) => {
    await expect(
      pool.query(
        `UPDATE tenants SET
           stripe_subscription_id  = $1,
           stripe_price_id         = $2,
           subscription_period_end = $3,
           cancel_at_period_end    = $4,
           status                  = $5,
           plan                    = $6
         WHERE id = $7`,
        ['sub_test', 'price_test', null, false, status, plan, tenantId],
      ),
    ).resolves.toBeDefined();

    const { rows: [row] } = await pool.query('SELECT status, plan FROM tenants WHERE id = $1', [tenantId]);
    expect(row.status).toBe(status);
    expect(row.plan).toBe(plan);
  });

  it('accepts checkout.session.completed statement (stripe_customer_id link)', async () => {
    await expect(
      pool.query('UPDATE tenants SET stripe_customer_id = $1 WHERE id = $2', ['cus_test', tenantId]),
    ).resolves.toBeDefined();
  });

  // ── Negative control: proves the constraint enforces the NEW vocabulary,
  // not that it was simply dropped/widened without limit.
  it('still rejects the legacy double-L "cancelled" spelling with a 23514 check_violation', async () => {
    await expect(
      pool.query('UPDATE tenants SET status = $1 WHERE id = $2', ['cancelled', tenantId]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('still rejects the legacy "professional" plan id with a 23514 check_violation', async () => {
    await expect(
      pool.query('UPDATE tenants SET plan = $1 WHERE id = $2', ['professional', tenantId]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
