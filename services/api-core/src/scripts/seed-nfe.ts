// Seed completo do fluxo de NF-e para desenvolvimento local.
//
// Cria (idempotente) tudo que a tela "Nova NF-e" precisa — tenant emitente com
// dados fiscais, cliente PJ com endereço, produto com NCM — e uma NF-e em
// rascunho com 1 item. Em seguida dispara a emissão real
// (POST /v1/invoices/:id/emit) para exercitar o pipeline SQS → lambda-fiscal →
// LocalStack. Sem token Focus real, a NF-e termina em status `rejected` — o que
// é esperado e demonstra o fluxo ponta a ponta.
//
// Uso: docker compose exec api-core npm run seed:nfe

import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

const EMAIL    = (process.env.SEED_EMAIL    ?? 'admin@erp.local').toLowerCase().trim();
const PASSWORD = process.env.SEED_PASSWORD  ?? 'Admin@2024';
const COMPANY  = process.env.SEED_COMPANY   ?? 'ERP Lite Demo';
const TAX_ID   = process.env.SEED_TAX_ID    ?? '11444777000161';

// A NF-e de demo é marcada por estas notas para reexecução limpa.
const SEED_MARK = '__seed_nfe__';

// Onde o próprio servidor api-core escuta dentro do container.
const API_BASE = process.env.SEED_API_BASE ?? `http://localhost:${process.env.PORT ?? '3000'}`;

async function seed() {
  try {
    const result = await db.transaction(async (tx) => {
      /* ── Tenant + admin user (mesmo padrão de seed.ts) ──────────────── */
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

      /* ── Configuração NF-e / emitente ───────────────────────────────── */
      await tx.execute(sql`
        INSERT INTO nfe_configs (
          tenant_id, cnpj, razao_social, nome_fantasia, regime_tributario,
          logradouro, numero, bairro, municipio, uf, cep, telefone, email,
          cfop_padrao, natureza_operacao, focus_ambiente
        ) VALUES (
          ${tenantId}, ${TAX_ID}, ${COMPANY}, ${COMPANY}, 2,
          'Avenida Paulista', '1000', 'Bela Vista', 'SAO PAULO', 'SP', '01310100',
          '1133334444', ${EMAIL}, '5102', 'Venda de mercadoria', 2
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          cnpj = EXCLUDED.cnpj, razao_social = EXCLUDED.razao_social,
          logradouro = EXCLUDED.logradouro, numero = EXCLUDED.numero,
          bairro = EXCLUDED.bairro, municipio = EXCLUDED.municipio,
          uf = EXCLUDED.uf, cep = EXCLUDED.cep, focus_ambiente = EXCLUDED.focus_ambiente,
          updated_at = NOW()
      `);

      /* ── Cliente PJ (destinatário) ──────────────────────────────────── */
      const { rows: [client] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO clients (
          tenant_id, person_type, company_name, trade_name, cnpj,
          email, phone, zip_code, street, street_number, neighborhood,
          city, state, icms_taxpayer, consumer_type, is_active
        ) VALUES (
          ${tenantId}, 'PJ', 'Cliente Demo Comércio Ltda', 'Cliente Demo', '12345678000190',
          'cliente.demo@example.com', '1199998888', '04538132', 'Avenida Brigadeiro Faria Lima',
          '3477', 'Itaim Bibi', 'SAO PAULO', 'SP', '1', '0', true
        )
        ON CONFLICT (tenant_id, cnpj) DO UPDATE SET
          company_name = EXCLUDED.company_name, is_active = true,
          street = EXCLUDED.street, street_number = EXCLUDED.street_number,
          neighborhood = EXCLUDED.neighborhood, city = EXCLUDED.city,
          state = EXCLUDED.state, zip_code = EXCLUDED.zip_code
        RETURNING id
      `);

      /* ── Produto com NCM ────────────────────────────────────────────── */
      const { rows: [material] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO materials (
          tenant_id, sku, name, description, type, unit,
          sale_price, cost_price, ncm_code, is_active, tracks_inventory
        ) VALUES (
          ${tenantId}, 'PROD-DEMO-001', 'Produto Demo NF-e', 'Item de demonstração para NF-e',
          'product', 'UN', 100.00, 60.00, '84714900', true, true
        )
        ON CONFLICT (tenant_id, sku) DO UPDATE SET
          name = EXCLUDED.name, sale_price = EXCLUDED.sale_price,
          ncm_code = EXCLUDED.ncm_code, is_active = true
        RETURNING id
      `);

      /* ── Limpa NF-e de demo anterior (reexecução idempotente) ───────── */
      await tx.execute(sql`
        DELETE FROM invoices
        WHERE tenant_id = ${tenantId} AND notes = ${SEED_MARK} AND status = 'draft'
      `);

      /* ── NF-e rascunho + item (espelha invoices.ts POST) ────────────── */
      const qty = 1, unitPrice = 100;
      const subtotal = qty * unitPrice;            // 100
      const icmsValue = 18, pisValue = 1.65, cofinsValue = 7.6;
      const taxTotal = Math.round((icmsValue + pisValue + cofinsValue) * 100) / 100;
      const total = subtotal;                      // sem IPI

      const { rows: [invoice] } = await tx.execute<{ id: string }>(sql`
        INSERT INTO invoices (
          tenant_id, client_id, serie, status, notes,
          subtotal, tax_total, total, tax_regime, origin_state,
          icms_total, pis_total, cofins_total
        ) VALUES (
          ${tenantId}, ${client.id}, '1', 'draft', ${SEED_MARK},
          ${String(subtotal)}, ${String(taxTotal)}, ${String(total)}, 'lucro_presumido', 'SP',
          ${String(icmsValue)}, ${String(pisValue)}, ${String(cofinsValue)}
        )
        RETURNING id
      `);

      await tx.execute(sql`
        INSERT INTO invoice_items (
          invoice_id, material_id, name, ncm_code, cfop, quantity, unit_price, total,
          icms_cst, icms_base, icms_rate, icms_value,
          pis_cst, pis_base, pis_rate, pis_value,
          cofins_cst, cofins_base, cofins_rate, cofins_value
        ) VALUES (
          ${invoice.id}, ${material.id}, 'Produto Demo NF-e', '84714900', '5102',
          ${String(qty)}, ${String(unitPrice)}, ${String(subtotal)},
          '00', ${String(subtotal)}, '18.00', ${String(icmsValue)},
          '01', ${String(subtotal)}, '1.65', ${String(pisValue)},
          '01', ${String(subtotal)}, '7.60', ${String(cofinsValue)}
        )
      `);

      return { tenantId, invoiceId: invoice.id, companyName: tenant.company_name };
    });

    /* ── Dispara a emissão real (pipeline SQS → lambda-fiscal) ────────── */
    const emitUrl = `${API_BASE}/v1/invoices/${result.invoiceId}/emit?tenant_id=${result.tenantId}`;
    let emitMsg = 'não disparada';
    try {
      const res = await fetch(emitUrl, { method: 'POST' });
      const bodyText = await res.text();
      emitMsg = `HTTP ${res.status} — ${bodyText}`;
    } catch (err) {
      emitMsg = `falhou ao chamar ${emitUrl}: ${(err as Error).message}`;
    }

    console.log('');
    console.log('✅  Seed NF-e concluído!');
    console.log(`🏢  Empresa   : ${result.companyName}`);
    console.log(`🆔  Tenant ID : ${result.tenantId}`);
    console.log(`🧾  Invoice ID: ${result.invoiceId}`);
    console.log(`📤  Emissão   : ${emitMsg}`);
    console.log(`👤  Login     : ${EMAIL} / ${PASSWORD}`);
    console.log('');
    console.log('➡️   Abra http://localhost:5173 → Notas Fiscais para ver a NF-e.');
    console.log(`➡️   Status: curl -s http://localhost:3004/v1/invoices/${result.invoiceId}/nfe`);
    console.log('');
  } catch (err) {
    console.error('❌  Seed NF-e falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seed();
