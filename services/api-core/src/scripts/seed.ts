import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

const EMAIL    = (process.env.SEED_EMAIL    ?? 'admin@erp.local').toLowerCase().trim();
const PASSWORD = process.env.SEED_PASSWORD  ?? 'Admin@2024';
const COMPANY  = process.env.SEED_COMPANY   ?? 'ERP Lite Demo';
const TAX_ID   = process.env.SEED_TAX_ID    ?? '11444777000161';

// Endereço/contato fictícios — só para o rodapé da proposta pública ter as
// 4 colunas completas (endereço, CNPJ/IE, e-mail, telefone) em dev local.
const STREET       = 'Av. Paulista';
const STREET_NUM   = '1000';
const NEIGHBORHOOD = 'Bela Vista';
const CITY         = 'São Paulo';
const STATE        = 'SP';
const POSTAL_CODE  = '01310100';
const PHONE        = '11987654321';
const WEBSITE      = 'https://erplitedemo.com.br';
const CONTACT_EMAIL = 'contato@erplitedemo.com.br';
const STATE_REG    = '110042490114';

async function seed() {
  try {
    const [tenant, user] = await db.transaction(async (tx) => {
      const { rows: [t] } = await tx.execute<{ id: string; company_name: string }>(sql`
        INSERT INTO tenants (
          company_name, trade_name, tax_id, tax_id_type, status, plan,
          street, street_number, neighborhood, city, state, postal_code,
          phone, website, purchasing_contact_email, state_reg
        )
        VALUES (
          ${COMPANY}, ${COMPANY}, ${TAX_ID}, 'CNPJ', 'active', 'enterprise',
          ${STREET}, ${STREET_NUM}, ${NEIGHBORHOOD}, ${CITY}, ${STATE}, ${POSTAL_CODE},
          ${PHONE}, ${WEBSITE}, ${CONTACT_EMAIL}, ${STATE_REG}
        )
        ON CONFLICT (tax_id, tax_id_type)
        DO UPDATE SET
          company_name = EXCLUDED.company_name, status = 'active',
          street = EXCLUDED.street, street_number = EXCLUDED.street_number,
          neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city,
          state = EXCLUDED.state, postal_code = EXCLUDED.postal_code,
          phone = EXCLUDED.phone, website = EXCLUDED.website,
          purchasing_contact_email = EXCLUDED.purchasing_contact_email,
          state_reg = EXCLUDED.state_reg
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
