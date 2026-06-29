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
             COALESCE(t.trade_name, t.company_name) AS issuer_name,
             t.logo_url AS issuer_logo
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
      SELECT name, sku, unit, quantity, unit_price, discount_pct, total, notes
      FROM proposal_items WHERE proposal_id = ${p.id} ORDER BY sort_order, created_at
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
      })),
      issuer: {
        name:     p.issuer_name || 'Empresa',
        logo_url: p.issuer_logo || null,
      },
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
