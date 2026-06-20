import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

const EMAIL    = (process.env.SEED_EMAIL    ?? 'admin@erp.local').toLowerCase().trim();
const PASSWORD = process.env.SEED_PASSWORD  ?? 'Admin@2024';
const COMPANY  = process.env.SEED_COMPANY   ?? 'ERP Lite Demo';
const TAX_ID   = process.env.SEED_TAX_ID    ?? '11444777000161';

async function seed() {
  try {
    const [tenant, user] = await db.transaction(async (tx) => {
      const { rows: [t] } = await tx.execute<{ id: string; company_name: string }>(sql`
        INSERT INTO tenants (company_name, trade_name, tax_id, tax_id_type, status, plan)
        VALUES (${COMPANY}, ${COMPANY}, ${TAX_ID}, 'CNPJ', 'active', 'enterprise')
        ON CONFLICT (tax_id, tax_id_type)
        DO UPDATE SET company_name = EXCLUDED.company_name, status = 'active'
        RETURNING id, company_name
      `);

      const hash = await bcrypt.hash(PASSWORD, 12);
      const { rows: [u] } = await tx.execute<{ id: string; email: string; role: string }>(sql`
        INSERT INTO users (tenant_id, email, name, password_hash, role, status)
        VALUES (${t.id}, ${EMAIL}, 'Admin', ${hash}, 'owner', 'active')
        ON CONFLICT (tenant_id, email)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
        RETURNING id, email, role
      `);

      return [t, u] as const;
    });

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
    console.error('❌  Seed falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seed();
