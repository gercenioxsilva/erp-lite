import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { sendSystemNotification } from '../lib/notificationsClient';

export const publicRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /v1/public/proposals/:token ───────────────────────────────────
  fastify.get('/public/proposals/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    if (!/^[0-9a-f]{64}$/i.test(token)) return reply.notFound('Proposta não encontrada');

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.id, p.number, p.title, p.status, p.total, p.subtotal, p.discount, p.shipping,
             p.valid_until, p.notes, p.terms_text, p.delivery_time, p.payment_method, p.accepted_at, p.accepted_by_name,
             p.rejected_at, p.rejected_reason, p.public_viewed_at, p.seller_email,
             COALESCE(c.company_name, c.full_name) AS client_name,
             c.person_type AS client_person_type, c.cnpj AS client_cnpj, c.cpf AS client_cpf,
             c.state_reg AS client_state_reg, c.email AS client_email, c.phone AS client_phone, c.mobile AS client_mobile,
             c.zip_code AS client_zip, c.street AS client_street, c.street_number AS client_number,
             c.complement AS client_complement, c.neighborhood AS client_neighborhood,
             c.city AS client_city, c.state AS client_state,
             COALESCE(t.trade_name, t.company_name) AS issuer_name,
             t.company_name AS issuer_company, t.tax_id AS issuer_tax_id, t.tax_id_type AS issuer_tax_id_type,
             t.street AS issuer_street, t.street_number AS issuer_number, t.complement AS issuer_complement,
             t.neighborhood AS issuer_neighborhood, t.city AS issuer_city, t.state AS issuer_state,
             t.postal_code AS issuer_zip, t.phone AS issuer_phone, t.website AS issuer_website,
             COALESCE(t.fiscal_contact_email, t.purchasing_contact_email) AS issuer_email,
             t.logo_url AS issuer_logo, t.state_reg AS issuer_state_reg,
             t.proposal_banner_url AS issuer_banner
      FROM proposals p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN tenants  t ON t.id = p.tenant_id
      WHERE p.public_token = ${token}
        AND p.status NOT IN ('draft', 'cancelled')
    `);

    if (!p) return reply.notFound('Proposta não encontrada');

    const today = new Date().toISOString().slice(0, 10);
    if (p.valid_until && p.valid_until < today && ['sent','viewed'].includes(p.status)) {
      await db.execute(sql`UPDATE proposals SET status = 'expired' WHERE id = ${p.id}`);
      p.status = 'expired';
    }

    if (p.status === 'sent') {
      await db.execute(sql`
        UPDATE proposals SET status = 'viewed', public_viewed_at = NOW() WHERE id = ${p.id}
      `);
      p.status = 'viewed';
      p.public_viewed_at = new Date().toISOString();
    }

    const { rows: items } = await db.execute<any>(sql`
      SELECT pi.name, pi.sku, pi.unit, pi.quantity, pi.unit_price, pi.discount_pct, pi.total, pi.notes,
             mi.image_data AS image_url
      FROM proposal_items pi
      LEFT JOIN LATERAL (
        SELECT image_data FROM material_images
        WHERE material_id = pi.material_id
        ORDER BY is_cover DESC, position ASC
        LIMIT 1
      ) mi ON true
      WHERE pi.proposal_id = ${p.id} ORDER BY pi.sort_order, pi.created_at
    `);

    return {
      proposal: {
        number:           p.number,
        title:            p.title,
        status:           p.status,
        valid_until:      p.valid_until,
        notes:            p.notes,
        terms_text:       p.terms_text,
        subtotal:         Number(p.subtotal),
        discount:         Number(p.discount),
        shipping:         Number(p.shipping),
        total:            Number(p.total),
        delivery_time:    p.delivery_time,
        payment_method:   p.payment_method,
        accepted_at:      p.accepted_at,
        accepted_by_name: p.accepted_by_name,
        rejected_at:      p.rejected_at,
        rejected_reason:  p.rejected_reason,
      },
      items: items.map((it: any) => ({
        name:         it.name,
        sku:          it.sku,
        unit:         it.unit,
        quantity:     Number(it.quantity),
        unit_price:   Number(it.unit_price),
        discount_pct: Number(it.discount_pct),
        total:        Number(it.total),
        notes:        it.notes,
        image_url:    it.image_url || null,
      })),
      issuer: {
        name:        p.issuer_name || 'Empresa',
        company:     p.issuer_company || null,
        logo_url:    p.issuer_logo || null,
        banner_url:  p.issuer_banner || null,
        document:    p.issuer_tax_id || null,
        document_type: p.issuer_tax_id_type || 'CNPJ',
        state_reg:   p.issuer_state_reg || null,
        email:       p.issuer_email || null,
        phone:       p.issuer_phone || null,
        website:     p.issuer_website || null,
        street:      p.issuer_street || null,
        street_number: p.issuer_number || null,
        complement:  p.issuer_complement || null,
        neighborhood: p.issuer_neighborhood || null,
        city:        p.issuer_city || null,
        state:       p.issuer_state || null,
        zip_code:    p.issuer_zip || null,
      },
      client: p.client_name ? {
        name:          p.client_name,
        document:      p.client_person_type === 'PF' ? (p.client_cpf || null) : (p.client_cnpj || null),
        document_type: p.client_person_type === 'PF' ? 'CPF' : 'CNPJ',
        state_reg:     p.client_state_reg || null,
        email:         p.client_email || null,
        phone:         p.client_phone || p.client_mobile || null,
        street:        p.client_street || null,
        street_number: p.client_number || null,
        complement:    p.client_complement || null,
        neighborhood:  p.client_neighborhood || null,
        city:          p.client_city || null,
        state:         p.client_state || null,
        zip_code:      p.client_zip || null,
      } : null,
      client_name: p.client_name || null,
    };
  });

  // ── POST /v1/public/proposals/:token/accept ───────────────────────────
  fastify.post('/public/proposals/:token/accept', async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[0-9a-f]{64}$/i.test(token)) return reply.notFound('Proposta não encontrada');

    const { name, email, notes: acceptNotes } = request.body as any;
    if (!name?.trim())  return reply.badRequest('name é obrigatório');
    if (!email?.trim()) return reply.badRequest('email é obrigatório');

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.id, p.status, p.number, p.title, p.total, p.seller_email, p.tenant_id,
             COALESCE(t.trade_name, t.company_name) AS issuer_name
      FROM proposals p LEFT JOIN tenants t ON t.id = p.tenant_id
      WHERE p.public_token = ${token} AND p.status NOT IN ('draft','cancelled')
    `);

    if (!p) return reply.notFound('Proposta não encontrada');
    if (!['sent','viewed'].includes(p.status)) {
      if (p.status === 'accepted') return { ok: true, already: true };
      return reply.badRequest('Esta proposta não está disponível para aceite');
    }

    await db.execute(sql`
      UPDATE proposals SET
        status            = 'accepted',
        accepted_at       = NOW(),
        accepted_by_name  = ${name.trim()},
        accepted_by_email = ${email.trim()},
        accepted_notes    = ${acceptNotes?.trim() || null}
      WHERE id = ${p.id}
    `);

    if (p.seller_email) {
      sendSystemNotification({
        tenant_id: p.tenant_id,
        type: 'proposal_accepted',
        recipient: { email: p.seller_email, name: 'Equipe de Vendas' },
        data: {
          accepted_by_name:  name.trim(),
          accepted_by_email: email.trim(),
          proposal_number:   p.number,
          proposal_title:    p.title,
          total:             Number(p.total).toFixed(2),
          accepted_notes:    acceptNotes?.trim() || '',
          issuer_name:       p.issuer_name || '',
        },
      }).catch(() => {});
    }

    return { ok: true };
  });

  // ── POST /v1/public/proposals/:token/reject ───────────────────────────
  fastify.post('/public/proposals/:token/reject', async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[0-9a-f]{64}$/i.test(token)) return reply.notFound('Proposta não encontrada');

    const { reason } = request.body as any;

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.id, p.status, p.number, p.title, p.seller_email, p.tenant_id,
             COALESCE(t.trade_name, t.company_name) AS issuer_name
      FROM proposals p LEFT JOIN tenants t ON t.id = p.tenant_id
      WHERE p.public_token = ${token} AND p.status NOT IN ('draft','cancelled')
    `);

    if (!p) return reply.notFound('Proposta não encontrada');
    if (!['sent','viewed'].includes(p.status)) {
      if (p.status === 'rejected') return { ok: true, already: true };
      return reply.badRequest('Esta proposta não está disponível para recusa');
    }

    await db.execute(sql`
      UPDATE proposals SET
        status          = 'rejected',
        rejected_at     = NOW(),
        rejected_reason = ${reason?.trim() || null}
      WHERE id = ${p.id}
    `);

    if (p.seller_email) {
      sendSystemNotification({
        tenant_id: p.tenant_id,
        type: 'proposal_rejected',
        recipient: { email: p.seller_email, name: 'Equipe de Vendas' },
        data: {
          proposal_number: p.number,
          proposal_title:  p.title,
          rejected_reason: reason?.trim() || 'Sem motivo informado',
          issuer_name:     p.issuer_name || '',
        },
      }).catch(() => {});
    }

    return { ok: true };
  });
};
