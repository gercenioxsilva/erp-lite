import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';

const EMAIL    = (process.env.SEED_EMAIL    ?? 'admin@erp.local').toLowerCase().trim();
const PASSWORD = process.env.SEED_PASSWORD  ?? 'Admin@2024';
const COMPANY  = process.env.SEED_COMPANY   ?? 'ERP Lite Demo';
const TAX_ID   = process.env.SEED_TAX_ID    ?? '11444777000161'; // valid CNPJ

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (company_name, trade_name, tax_id, tax_id_type, status, plan)
       VALUES ($1, $1, $2, 'CNPJ', 'active', 'enterprise')
       ON CONFLICT (tax_id, tax_id_type)
       DO UPDATE SET company_name = EXCLUDED.company_name, status = 'active'
       RETURNING id, company_name`,
      [COMPANY, TAX_ID],
    );

    const hash = await bcrypt.hash(PASSWORD, 12);
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role, status)
       VALUES ($1, $2, 'Admin', $3, 'owner', 'active')
       ON CONFLICT (tenant_id, email)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
       RETURNING id, email, role`,
      [tenant.id, EMAIL, hash],
    );

    await client.query('COMMIT');

    console.log('');
    console.log('✅  Seed concluído!');
    console.log(`🏢  Empresa  : ${tenant.company_name}`);
    console.log(`🆔  Tenant ID: ${tenant.id}`);
    console.log(`👤  E-mail   : ${user.email}`);
    console.log(`🔑  Senha    : ${PASSWORD}`);
    console.log('');
    console.log('Para usar credenciais próprias:');
    console.log('  SEED_EMAIL=voce@empresa.com SEED_PASSWORD=SuaSenha npm run seed');
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Seed falhou:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void seed();
