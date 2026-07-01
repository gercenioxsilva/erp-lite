import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

/*
 * Seed de um cliente (PF) de demonstração — usado para testar o fluxo de envio
 * de proposta (POST /v1/proposals/:id/send) ponta a ponta em dev local.
 *
 * Idempotente: remove o cliente de demo anterior (notes contém o marcador
 * [seed-demo]) antes de recriar.
 *
 * Uso:  npm run seed:client
 * Pré-requisito: rode `npm run seed` (tenant) antes.
 */

const TAX_ID       = process.env.SEED_TAX_ID       ?? '11444777000161';
const CLIENT_NAME  = process.env.SEED_CLIENT_NAME  ?? 'Wladmyr Almeida';
const CLIENT_EMAIL = process.env.SEED_CLIENT_EMAIL ?? 'wladmyralmeida@gmail.com';
const MARKER = '[seed-demo]';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resolveTenant(tx: Tx) {
  const byTaxId = await tx.execute<{ id: string; company_name: string }>(sql`
    SELECT id, company_name FROM tenants
    WHERE tax_id = ${TAX_ID} AND tax_id_type = 'CNPJ'
    ORDER BY created_at DESC LIMIT 1
  `);
  if (byTaxId.rows[0]) return byTaxId.rows[0];
  const fallback = await tx.execute<{ id: string; company_name: string }>(sql`
    SELECT id, company_name FROM tenants ORDER BY created_at ASC LIMIT 1
  `);
  return fallback.rows[0] ?? null;
}

async function seedClient() {
  try {
    const summary = await db.transaction(async (tx) => {
      const tenant = await resolveTenant(tx);
      if (!tenant) throw new Error('Nenhum tenant encontrado. Rode `npm run seed` antes.');

      await tx.execute(sql`
        DELETE FROM clients WHERE tenant_id = ${tenant.id} AND notes LIKE ${'%' + MARKER + '%'}
      `);

      const { rows: [client] } = await tx.execute<{ id: string; email: string }>(sql`
        INSERT INTO clients
          (tenant_id, person_type, full_name, email, is_active, icms_taxpayer, consumer_type, notes)
        VALUES
          (${tenant.id}, 'PF', ${CLIENT_NAME}, ${CLIENT_EMAIL}, true, '9', '1', ${MARKER})
        RETURNING id, email
      `);

      return { tenant, client };
    });

    console.log('');
    console.log('✅  Seed de cliente concluído!');
    console.log(`🏢  Empresa    : ${summary.tenant.company_name}`);
    console.log(`🆔  Tenant ID  : ${summary.tenant.id}`);
    console.log(`👤  Cliente    : ${CLIENT_NAME}`);
    console.log(`📧  E-mail     : ${summary.client.email}`);
    console.log('');
    console.log('➡️   Rode `npm run seed:proposals` para gerar propostas de demo vinculadas a este cliente.');
    console.log('');
  } catch (err) {
    console.error('❌  Seed de cliente falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seedClient();
