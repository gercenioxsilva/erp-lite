// Seed do fluxo de NFS-e para desenvolvimento local.
//
// Cria (idempotente) tenant, usuário admin, cliente PJ e quatro NFS-e de
// demonstração cobrindo todos os status visíveis no frontend:
//   • authorized   — autorizada com número, protocolo e código de verificação
//   • rejected     — rejeitada com motivo e histórico de 2 tentativas
//   • pending      — aguardando processamento (sem retorno SEFAZ)
//   • processing   — em processamento (enviada, sem retorno ainda)
//
// Uso: docker compose exec api-core npm run seed:nfse

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

const EMAIL    = (process.env.SEED_EMAIL    ?? 'admin@erp.local').toLowerCase().trim();
const PASSWORD = process.env.SEED_PASSWORD  ?? 'Admin@2024';
const COMPANY  = process.env.SEED_COMPANY   ?? 'ERP Lite Demo';
const TAX_ID   = process.env.SEED_TAX_ID    ?? '11444777000161';

const SEED_MARK = '__seed_nfse__';

async function seed() {
  try {
    const result = await db.transaction(async (tx) => {
      /* ── Tenant + admin user ─────────────────────────────────────────── */
      const { rows: [tenant] } = await tx.execute<{ id: string; company_name: string }>(sql`
        INSERT INTO tenants (company_name, trade_name, tax_id, tax_id_type, status, plan)
        VALUES (${COMPANY}, ${COMPANY}, ${TAX_ID}, 'CNPJ', 'active', 'enterprise')
        ON CONFLICT (tax_id, tax_id_type)
        DO UPDATE SET company_name = EXCLUDED.company_name, status = 'active'
        RETURNING id, company_name
      `);
      const tenantId = tenant.id;

      const hash = await bcrypt.hash(PASSWORD, 12);
      await tx.execute(sql`
        INSERT INTO users (tenant_id, email, name, password_hash, role, status)
        VALUES (${tenantId}, ${EMAIL}, 'Admin', ${hash}, 'owner', 'active')
        ON CONFLICT (tenant_id, email)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, status = 'active'
      `);

      /* ── Cliente PJ tomador de serviço ──────────────────────────────── */
      const { rows: [client] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO clients (
          tenant_id, person_type, company_name, trade_name, cnpj,
          email, phone, zip_code, street, street_number, neighborhood,
          city, state, icms_taxpayer, consumer_type, is_active
        ) VALUES (
          ${tenantId}, 'PJ', 'Tecnologia Acme Ltda', 'Acme Tech', '98765432000155',
          'financeiro@acmetech.com.br', '1133339999', '01310100',
          'Avenida Paulista', '2000', 'Bela Vista', 'SAO PAULO', 'SP',
          '1', '0', true
        )
        ON CONFLICT (tenant_id, cnpj) DO UPDATE SET
          company_name = EXCLUDED.company_name, is_active = true
        RETURNING id
      `);

      /* ── Remove NFS-e de seeds anteriores (idempotente) ─────────────── */
      await tx.execute(sql`
        DELETE FROM nfse_invoices
        WHERE tenant_id = ${tenantId} AND description LIKE ${SEED_MARK + '%'}
      `);

      /* ── 1. NFS-e AUTORIZADA ─────────────────────────────────────────── */
      const { rows: [nfse1] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO nfse_invoices (
          tenant_id, client_id, description, amount, iss_rate, iss_value,
          service_code, period_start, period_end,
          nfse_status, nfse_number, nfse_verify_code, nfse_protocol,
          nfse_auth_date, nfse_attempts
        ) VALUES (
          ${tenantId}, ${client.id},
          ${SEED_MARK + ' Consultoria em Desenvolvimento de Software — Jun/2025'},
          '5000.00', '5.00', '250.00',
          '1.07', '2025-06-01', '2025-06-30',
          'authorized', '000042', 'AB3F9C12', 'NFSE-2025-000042',
          NOW() - INTERVAL '2 days', 1
        )
        RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO nfse_events (nfse_id, tenant_id, event_type, status_code, protocol, payload)
        VALUES
          (${nfse1.id}, ${tenantId}, 'emit_requested', NULL,  NULL,               NULL),
          (${nfse1.id}, ${tenantId}, 'sefaz_response', '100', 'NFSE-2025-000042', '{"message":"NFS-e autorizada com sucesso","numero":"000042"}'::jsonb)
      `);

      /* ── 2. NFS-e REJEITADA (2 tentativas) ──────────────────────────── */
      const { rows: [nfse2] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO nfse_invoices (
          tenant_id, client_id, description, amount, iss_rate, iss_value,
          service_code, period_start, period_end,
          nfse_status, nfse_reject_reason, nfse_attempts
        ) VALUES (
          ${tenantId}, ${client.id},
          ${SEED_MARK + ' Suporte Técnico Mensal — Mai/2025'},
          '1800.00', '5.00', '90.00',
          '1.07', '2025-05-01', '2025-05-31',
          'rejected',
          'Código de serviço 1.07 não homologado para o município 3550308. Utilize o código 1.05.',
          2
        )
        RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO nfse_events (nfse_id, tenant_id, event_type, status_code, protocol, payload)
        VALUES
          (${nfse2.id}, ${tenantId}, 'emit_requested', NULL,   NULL, NULL),
          (${nfse2.id}, ${tenantId}, 'sefaz_response', 'E200', NULL, '{"error":"Código de serviço inválido para o município"}'::jsonb),
          (${nfse2.id}, ${tenantId}, 'emit_requested', NULL,   NULL, NULL),
          (${nfse2.id}, ${tenantId}, 'sefaz_response', 'E200', NULL, '{"error":"Código de serviço 1.07 não homologado para o município 3550308. Utilize o código 1.05."}'::jsonb)
      `);

      /* ── 3. NFS-e PENDENTE ───────────────────────────────────────────── */
      const { rows: [nfse3] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO nfse_invoices (
          tenant_id, client_id, description, amount, iss_rate, iss_value,
          service_code, period_start, period_end,
          nfse_status, nfse_attempts
        ) VALUES (
          ${tenantId}, ${client.id},
          ${SEED_MARK + ' Desenvolvimento de API REST — Jul/2025'},
          '3200.00', '5.00', '160.00',
          '1.07', '2025-07-01', '2025-07-31',
          'pending', 0
        )
        RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO nfse_events (nfse_id, tenant_id, event_type, status_code, protocol, payload)
        VALUES
          (${nfse3.id}, ${tenantId}, 'emit_requested', NULL, NULL, NULL)
      `);

      /* ── 4. NFS-e EM PROCESSAMENTO ───────────────────────────────────── */
      const { rows: [nfse4] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO nfse_invoices (
          tenant_id, client_id, description, amount, iss_rate, iss_value,
          service_code, period_start, period_end,
          nfse_status, nfse_attempts
        ) VALUES (
          ${tenantId}, ${client.id},
          ${SEED_MARK + ' Análise e Mapeamento de Processos — Jul/2025'},
          '2400.00', '5.00', '120.00',
          '1.07', '2025-07-01', '2025-07-31',
          'processing', 1
        )
        RETURNING id
      `);
      await tx.execute(sql`
        INSERT INTO nfse_events (nfse_id, tenant_id, event_type, status_code, protocol, payload)
        VALUES
          (${nfse4.id}, ${tenantId}, 'emit_requested', NULL, NULL, NULL),
          (${nfse4.id}, ${tenantId}, 'processing',     NULL, NULL, '{"message":"Aguardando retorno da prefeitura"}'::jsonb)
      `);

      return {
        tenantId,
        companyName: tenant.company_name,
        ids: { nfse1: nfse1.id, nfse2: nfse2.id, nfse3: nfse3.id, nfse4: nfse4.id },
      };
    });

    console.log('');
    console.log('✅  Seed NFS-e concluído!');
    console.log(`🏢  Empresa     : ${result.companyName}`);
    console.log(`🆔  Tenant ID   : ${result.tenantId}`);
    console.log(`✓   Autorizada  : ${result.ids.nfse1}`);
    console.log(`✗   Rejeitada   : ${result.ids.nfse2}`);
    console.log(`⏳  Pendente    : ${result.ids.nfse3}`);
    console.log(`⚙   Processando : ${result.ids.nfse4}`);
    console.log(`👤  Login       : ${EMAIL} / ${PASSWORD}`);
    console.log('');
    console.log('➡️   Abra http://localhost:5173 → NFS-e para ver os registros.');
    console.log('');
  } catch (err) {
    console.error('❌  Seed NFS-e falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seed();
