// Seed das TRÊS personas do Agendamento para desenvolvimento local — a
// auditoria mostrou que o módulo estava configurado mas ninguém além do owner
// conseguia exercitá-lo (zero usuários professional/client, pacotes vazios,
// self-booking desligado). Idempotente; assume o tenant do seed principal.
//
// Cria/garante:
//   • professional@erp.local / Prof@2024   → role professional, vinculado ao
//     profissional sem login (ou cria "Profissional Demo")
//   • cliente@erp.local     / Cliente@2024 → role client, vinculado a um
//     cliente existente (ou cria "Cliente Portal Demo")
//   • template "Pacote 10 sessões" + pacote concedido ao cliente
//   • allow_self_booking = true (portal agendável)
//
// Uso: docker compose exec api-core npm run seed:scheduling

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

const ADMIN_EMAIL = (process.env.SEED_EMAIL ?? 'admin@erp.local').toLowerCase().trim();
const PROF_EMAIL = 'professional@erp.local';
const PROF_PASSWORD = 'Prof@2024';
const CLIENT_EMAIL = 'cliente@erp.local';
const CLIENT_PASSWORD = 'Cliente@2024';

async function seed() {
  try {
    const result = await db.transaction(async (tx) => {
      const { rows: [admin] } = await tx.execute<{ tenant_id: string }>(sql`
        SELECT tenant_id FROM users WHERE email = ${ADMIN_EMAIL} ORDER BY created_at LIMIT 1
      `);
      if (!admin) throw new Error(`Admin ${ADMIN_EMAIL} não encontrado — rode o seed principal antes.`);
      const tenantId = admin.tenant_id;

      /* ── Profissional com login ──────────────────────────────────────── */
      // Preferir um profissional ativo AINDA SEM login (o caso real da
      // auditoria: "Wladmyr Profissional" existia só como recurso agendável).
      let { rows: [prof] } = await tx.execute<{ id: string; name: string }>(sql`
        SELECT id, name FROM scheduling_professionals
        WHERE tenant_id = ${tenantId} AND user_id IS NULL AND is_active
        ORDER BY created_at LIMIT 1
      `);
      if (!prof) {
        ({ rows: [prof] } = await tx.execute<{ id: string; name: string }>(sql`
          INSERT INTO scheduling_professionals (tenant_id, name, is_active)
          VALUES (${tenantId}, 'Profissional Demo', true)
          RETURNING id, name
        `));
        // Grade seg–sex 08:00–18:00 para o novo profissional ter slots.
        for (let weekday = 1; weekday <= 5; weekday++) {
          await tx.execute(sql`
            INSERT INTO scheduling_availability_rules (tenant_id, professional_id, weekday, start_time, end_time)
            VALUES (${tenantId}, ${prof.id}, ${weekday}, '08:00', '18:00')
          `);
        }
        // Vincula à primeira área ativa (booking exige área do profissional).
        await tx.execute(sql`
          INSERT INTO scheduling_professional_areas (tenant_id, professional_id, area_id)
          SELECT ${tenantId}, ${prof.id}, id FROM scheduling_areas
          WHERE tenant_id = ${tenantId} AND is_active
          ORDER BY created_at LIMIT 1
          ON CONFLICT DO NOTHING
        `);
      }

      const profHash = await bcrypt.hash(PROF_PASSWORD, 12);
      const { rows: [profUser] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO users (tenant_id, email, name, password_hash, role, status)
        VALUES (${tenantId}, ${PROF_EMAIL}, ${prof.name}, ${profHash}, 'professional', 'active')
        ON CONFLICT (tenant_id, email)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'professional', status = 'active'
        RETURNING id
      `);
      await tx.execute(sql`
        UPDATE scheduling_professionals SET user_id = ${profUser.id} WHERE id = ${prof.id}
      `);

      /* ── Cliente com login de portal ─────────────────────────────────── */
      let { rows: [client] } = await tx.execute<{ id: string; name: string | null }>(sql`
        SELECT id, COALESCE(company_name, full_name) AS name FROM clients
        WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1
      `);
      if (!client) {
        ({ rows: [client] } = await tx.execute<{ id: string; name: string | null }>(sql`
          INSERT INTO clients (tenant_id, person_type, full_name, email, phone)
          VALUES (${tenantId}, 'PF', 'Cliente Portal Demo', ${CLIENT_EMAIL}, '(83) 99999-0000')
          RETURNING id, full_name AS name
        `));
      }

      const clientHash = await bcrypt.hash(CLIENT_PASSWORD, 12);
      await tx.execute(sql`
        INSERT INTO users (tenant_id, email, name, password_hash, role, status, client_id)
        VALUES (${tenantId}, ${CLIENT_EMAIL}, ${client.name ?? 'Cliente'}, ${clientHash}, 'client', 'active', ${client.id})
        ON CONFLICT (tenant_id, email)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'client', status = 'active', client_id = ${client.id}
      `);

      /* ── Pacote: template + concessão ────────────────────────────────── */
      const { rows: [template] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO scheduling_package_templates (tenant_id, name, session_count, validity_days, is_active)
        SELECT ${tenantId}, 'Pacote 10 sessões', 10, 90, true
        WHERE NOT EXISTS (
          SELECT 1 FROM scheduling_package_templates WHERE tenant_id = ${tenantId} AND name = 'Pacote 10 sessões'
        )
        RETURNING id
      `);
      void template;

      const { rows: [existingPkg] } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM scheduling_client_packages
        WHERE tenant_id = ${tenantId} AND client_id = ${client.id} AND status = 'active' LIMIT 1
      `);
      if (!existingPkg) {
        await tx.execute(sql`
          INSERT INTO scheduling_client_packages
            (tenant_id, client_id, name, total_sessions, used_sessions, payment_status, status, valid_until)
          VALUES (${tenantId}, ${client.id}, 'Pacote 10 sessões', 10, 0, 'paid', 'active', CURRENT_DATE + 90)
        `);
      }

      /* ── Portal agendável ────────────────────────────────────────────── */
      await tx.execute(sql`
        UPDATE scheduling_settings SET allow_self_booking = true WHERE tenant_id = ${tenantId}
      `);

      return { tenantId, prof: prof.name, client: client.name };
    });

    console.log('✅ Seed do Agendamento aplicado');
    console.log(`🏢 Tenant       : ${result.tenantId}`);
    console.log(`💇 Profissional : ${result.prof} → ${PROF_EMAIL} / ${PROF_PASSWORD}`);
    console.log(`👤 Cliente      : ${result.client} → ${CLIENT_EMAIL} / ${CLIENT_PASSWORD} (portal em /portal/entrar)`);
    console.log('📦 Pacote       : "Pacote 10 sessões" ativo e pago · self-booking LIGADO');
  } finally {
    await pool.end();
  }
}

seed().catch((err) => { console.error('Seed falhou:', err); process.exit(1); });
