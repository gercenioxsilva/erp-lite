import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db';

/*
 * Seed de PROPOSTAS de demonstração — cria propostas em vários status (rascunho,
 * enviada, aceita, recusada) usando os clientes e materiais já cadastrados.
 *
 * Idempotente: remove as propostas de demo anteriores (notes contém o marcador
 * [seed-demo]) antes de recriar.
 *
 * Uso:  npm run seed:proposals          (na pasta services/api-core)
 * Pré-requisitos: rode `npm run seed` (tenant) e `npm run seed:materials` antes.
 */

const TAX_ID = process.env.SEED_TAX_ID ?? '11444777000161';
const MARKER = '[seed-demo]';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const token = () => randomBytes(32).toString('hex');
const isoDate = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

interface ProposalSeed {
  title:          string;
  status:         'draft' | 'sent' | 'accepted' | 'rejected';
  validOffset:    number;            // dias a partir de hoje
  delivery_time:  string | null;
  payment_method: string | null;
  notes:          string | null;
  /** índices de materiais (na lista carregada) + quantidade/desconto */
  lines:          { matIdx: number; qty: number; disc: number }[];
}

const PROPOSALS: ProposalSeed[] = [
  {
    title: 'Proposta comercial — kit inicial', status: 'sent', validOffset: 15,
    delivery_time: '10 dias úteis', payment_method: 'pix', notes: 'Proposta enviada ao cliente.',
    lines: [{ matIdx: 0, qty: 50, disc: 0 }, { matIdx: 1, qty: 30, disc: 5 }],
  },
  {
    title: 'Reposição de estoque', status: 'draft', validOffset: 30,
    delivery_time: '15 dias úteis', payment_method: 'boleto', notes: 'Rascunho em elaboração.',
    lines: [{ matIdx: 2, qty: 100, disc: 0 }],
  },
  {
    title: 'Pedido recorrente mensal', status: 'accepted', validOffset: -5,
    delivery_time: '7 dias úteis', payment_method: 'card', notes: 'Cliente aceitou a proposta.',
    lines: [{ matIdx: 3, qty: 24, disc: 10 }, { matIdx: 0, qty: 12, disc: 0 }],
  },
  {
    title: 'Cotação avulsa', status: 'rejected', validOffset: -2,
    delivery_time: null, payment_method: 'to_agree', notes: 'Cliente optou por outro fornecedor.',
    lines: [{ matIdx: 1, qty: 5, disc: 0 }],
  },
];

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

async function seedProposals() {
  try {
    const summary = await db.transaction(async (tx) => {
      const tenant = await resolveTenant(tx);
      if (!tenant) throw new Error('Nenhum tenant encontrado. Rode `npm run seed` antes.');

      const materials = (await tx.execute<{ id: string; name: string; sku: string | null; unit: string; sale_price: string }>(sql`
        SELECT id, name, sku, unit, sale_price FROM materials
        WHERE tenant_id = ${tenant.id} AND is_active = true AND type <> 'kit'
        ORDER BY created_at ASC LIMIT 8
      `)).rows;
      if (materials.length < 4) {
        throw new Error('Materiais insuficientes. Rode `npm run seed:materials` antes.');
      }

      const clientRow = (await tx.execute<{ id: string }>(sql`
        SELECT id FROM clients WHERE tenant_id = ${tenant.id} AND is_active = true
        ORDER BY created_at ASC LIMIT 1
      `)).rows[0];
      const clientId = clientRow?.id ?? null;

      // Limpa propostas de demo anteriores (cascade remove os itens)
      await tx.execute(sql`DELETE FROM proposals WHERE tenant_id = ${tenant.id} AND notes LIKE ${'%' + MARKER + '%'}`);

      // Próximo número sequencial a partir do maior existente
      const maxRow = (await tx.execute<{ max: number }>(sql`
        SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '\D', '', 'g'), '')::int), 0) AS max
        FROM proposals WHERE tenant_id = ${tenant.id}
      `)).rows[0];
      let next = Number(maxRow?.max ?? 0);

      let created = 0;
      for (const p of PROPOSALS) {
        next += 1;
        const number = String(next).padStart(5, '0');

        const lines = p.lines.map((l) => {
          const mat = materials[l.matIdx % materials.length];
          const unitPrice = Number(mat.sale_price);
          const total = unitPrice * l.qty * (1 - l.disc / 100);
          return { mat, qty: l.qty, disc: l.disc, unitPrice, total };
        });
        const subtotal = lines.reduce((s, l) => s + l.total, 0);
        const total = subtotal; // sem desconto/frete no cabeçalho desta demo

        const { rows: [prop] } = await tx.execute<{ id: string }>(sql`
          INSERT INTO proposals
            (tenant_id, client_id, number, title, status, subtotal, discount, shipping, total,
             valid_until, notes, delivery_time, payment_method, public_token, seller_email,
             public_viewed_at, accepted_at, accepted_by_name, accepted_by_email, rejected_at, rejected_reason)
          VALUES
            (${tenant.id}, ${clientId}, ${number}, ${p.title}, ${p.status},
             ${subtotal.toFixed(2)}, '0', '0', ${total.toFixed(2)},
             ${isoDate(p.validOffset)}, ${p.notes + ' ' + MARKER}, ${p.delivery_time}, ${p.payment_method},
             ${p.status === 'draft' ? null : token()},
             'vendas@demo.local',
             ${p.status === 'sent' || p.status === 'accepted' ? sql`NOW()` : null},
             ${p.status === 'accepted' ? sql`NOW()` : null},
             ${p.status === 'accepted' ? 'Cliente Demo' : null},
             ${p.status === 'accepted' ? 'cliente@demo.local' : null},
             ${p.status === 'rejected' ? sql`NOW()` : null},
             ${p.status === 'rejected' ? 'Preço acima do orçamento.' : null})
          RETURNING id
        `);

        let sort = 0;
        for (const l of lines) {
          await tx.execute(sql`
            INSERT INTO proposal_items
              (proposal_id, material_id, name, sku, unit, quantity, unit_price, discount_pct, total, sort_order)
            VALUES
              (${prop.id}, ${l.mat.id}, ${l.mat.name}, ${l.mat.sku}, ${l.mat.unit},
               ${l.qty.toFixed(3)}, ${l.unitPrice.toFixed(2)}, ${l.disc.toFixed(2)}, ${l.total.toFixed(2)}, ${sort++})
          `);
        }
        created += 1;
      }

      return { tenant, created, hasClient: !!clientId };
    });

    console.log('');
    console.log('✅  Seed de propostas concluído!');
    console.log(`🏢  Empresa  : ${summary.tenant.company_name}`);
    console.log(`🆔  Tenant ID: ${summary.tenant.id}`);
    console.log(`📄  Propostas: ${summary.created} (rascunho, enviada, aceita, recusada)`);
    if (!summary.hasClient) console.log('⚠️   Nenhum cliente ativo — propostas criadas sem cliente vinculado.');
    console.log('');
    console.log('➡️   Veja em Propostas. As "enviadas/aceitas" têm token público (/p/:token).');
    console.log('');
  } catch (err) {
    console.error('❌  Seed de propostas falhou:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void seedProposals();
