import { Pool } from 'pg';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Belt-and-suspenders: pg v8.x may not apply the Pool ssl option when parsing a plain
// postgres:// URL (no sslmode in the string). Setting PGSSLMODE here guarantees SSL
// for any non-local host, regardless of how the caller configured the environment.
const _migrateHost = process.env.DB_HOST || 'localhost';
const _migrateLocal = _migrateHost === 'localhost' || _migrateHost === '127.0.0.1' || _migrateHost === 'db';
if (!_migrateLocal && !process.env.PGSSLMODE) process.env.PGSSLMODE = 'require';

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15_000,
      // PGSSLMODE=require is injected by ECS task env → { rejectUnauthorized:false }.
      // Not set locally (Docker postgres has no SSL) → ssl:false.
      // NOTE: explicit ssl:false overrides PGSSLMODE, so we must NOT pass ssl:false when SSL is needed.
      // We drive this off PGSSLMODE, not NODE_ENV, because ECS uses NODE_ENV=prod (not "production").
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      host: _migrateHost,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'erp_lite',
      user: process.env.DB_USER || 'erp_lite',
      password: process.env.DB_PASSWORD || 'erp_lite',
      connectionTimeoutMillis: 15_000,
      ssl: _migrateLocal ? undefined : { rejectUnauthorized: false },
    });

const migrations = [
  '0001_tenants.sql',
  '0002_users.sql',
  '0003_materials.sql',
  '0004_inventory.sql',
  '0005_clients.sql',
  '0006_orders.sql',
  '0007_invoices.sql',
  '0008_invoice_taxes.sql',
  '0009_nfe.sql',
  '0010_notification_configs.sql',
  '0011_tenant_logo.sql',
  '0012_receivables.sql',
  '0013_payables.sql',
  '0014_tenant_banking.sql',
  '0015_client_contacts.sql',
  '0016_service_contracts.sql',
  '0017_nfe_tokens.sql',
  '0018_material_images.sql',
  '0019_nfse.sql',
  '0020_suppliers.sql',
  '0021_users_password_reset.sql',
  '0022_payables_recurrence.sql',
  '0023_notification_due.sql',
  '0024_proposals.sql',
  '0025_tenant_itau_oauth.sql',
  '0026_stripe_billing.sql',
  '0027_cost_centers.sql',
  '0028_cost_center_stock.sql',
  '0029_stripe_price_ids.sql',
  '0030_material_components.sql',
  '0031_materials_kit_type.sql',
  '0032_material_dimensions.sql',
  '0033_proposal_terms.sql',
  '0034_pos.sql',
  '0035_pos_fiscal_fix.sql',
  '0036_sellers.sql',
  '0037_tenant_proposal_branding.sql',
  '0038_pos_integration.sql',
  '0039_tax_rules.sql',
  '0040_purchase_orders.sql',
  '0041_supplier_invoices.sql',
  '0042_dre.sql',
  '0043_cnpj_alphanum.sql',
  '0044_service_orders.sql',
];

// Splits SQL into individual statements, correctly handling:
// dollar-quoted strings ($$...$$), single-quoted strings, -- comments, /* */ comments
function splitSqlStatements(sql: string): string[] {
  const stmts: string[] = [];
  let buf = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    if (ch === '$') {
      const tagMatch = sql.slice(i).match(/^\$([^$]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        if (closeIdx !== -1) { buf += sql.slice(i, closeIdx + tag.length); i = closeIdx + tag.length; continue; }
      }
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && j + 1 < len && sql[j + 1] === "'") { j += 2; }
        else if (sql[j] === "'") { j++; break; }
        else { j++; }
      }
      buf += sql.slice(i, j); i = j; continue;
    }
    if (ch === '-' && i + 1 < len && sql[i + 1] === '-') {
      const eol = sql.indexOf('\n', i);
      buf += eol === -1 ? sql.slice(i) : sql.slice(i, eol + 1);
      i = eol === -1 ? len : eol + 1; continue;
    }
    if (ch === '/' && i + 1 < len && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      buf += end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      i = end === -1 ? len : end + 2; continue;
    }
    if (ch === ';') {
      const stmt = buf.trim();
      if (stmt) stmts.push(stmt);
      buf = ''; i++; continue;
    }
    buf += ch; i++;
  }
  const last = buf.trim();
  if (last) stmts.push(last);
  return stmts.filter(s => s.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration   TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function isApplied(migration: string) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM schema_migrations WHERE migration = $1', [migration]
  );
  return (rowCount ?? 0) > 0;
}

async function runMigrations() {
  const migrationsDir = existsSync('/app/db/migrations')
    ? '/app/db/migrations'
    : join(process.cwd(), 'db', 'migrations');

  await ensureMigrationsTable();

  for (const file of migrations) {
    if (await isApplied(file)) { console.log(`  skip  ${file}`); continue; }

    console.log(`  run   ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(sql);
    let idx = 0;
    for (const stmt of statements) {
      idx++;
      try {
        await pool.query(stmt);
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('already exists') || msg.includes('duplicate key')) {
          console.log(`    [${file}:${idx}] skipped (already exists)`);
        } else {
          console.error(`    [${file}:${idx}] FAILED: ${stmt.replace(/\s+/g, ' ').slice(0, 150)}`);
          throw err;
        }
      }
    }
    await pool.query('INSERT INTO schema_migrations (migration) VALUES ($1)', [file]);
    console.log(`  done  ${file}`);
  }
  console.log('All migrations applied.');
}

runMigrations()
  .catch(err => { console.error('Migration failed:', err); process.exit(1); })
  .finally(() => pool.end());
