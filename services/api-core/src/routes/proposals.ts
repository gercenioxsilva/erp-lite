import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { sendSystemNotification } from '../lib/notificationsClient';
import { requirePermission } from '../lib/requirePermission';
import { notifyProposalSent } from '../services/whatsappAutomationService';

function calcProposalTotals(items: any[], discount = 0, shipping = 0) {
  const subtotal = items.reduce((s: number, it: any) => {
    const lineTotal = Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_pct || 0) / 100);
    return s + lineTotal;
  }, 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    total:    Math.round((subtotal - Number(discount) + Number(shipping)) * 100) / 100,
  };
}

function generatePublicToken(): string {
  const { randomUUID } = require('crypto') as typeof import('crypto');
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

export const proposalsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [(fastify as any).authenticate] };

  // ── GET /v1/proposals ──────────────────────────────────────────────────
  fastify.get('/proposals', { ...auth, preHandler: [requirePermission('proposals:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { status, search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status && status !== 'all' ? sql`AND p.status = ${status}` : sql``;
    const searchFilter = search
      ? sql`AND (p.number ILIKE ${'%' + search + '%'} OR p.title ILIKE ${'%' + search + '%'} OR COALESCE(c.company_name, c.full_name) ILIKE ${'%' + search + '%'})`
      : sql``;

    const [listResult, countResult] = await Promise.all([
      db.execute<any>(sql`
        SELECT p.id, p.number, p.title, p.status, p.total, p.valid_until,
               p.public_token, p.accepted_at, p.rejected_at, p.converted_to_order_id,
               p.created_at, p.updated_at,
               COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email
        FROM proposals p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM proposals p LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.tenant_id = ${tenantId} ${statusFilter} ${searchFilter}
      `),
    ]);
    const rows = listResult.rows;
    const cnt  = countResult.rows[0];

    return { data: rows, total: Number(cnt?.count ?? 0), page: Number(page), per_page: limit };
  });

  // ── POST /v1/proposals ─────────────────────────────────────────────────
  fastify.post('/proposals', { ...auth, preHandler: [requirePermission('proposals:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userEmail = (request as any).user.email;
    const userId    = (request as any).user.id;
    const { client_id, title, valid_until, notes, terms_text, commercial_message, delivery_time, payment_method, discount = 0, shipping = 0, items } =
      request.body as any;

    if (!title?.trim())                             return reply.badRequest('title é obrigatório');
    if (!Array.isArray(items) || !items.length)     return reply.badRequest('Ao menos um item é necessário');

    for (const it of items) {
      if (!it.name?.trim())         return reply.badRequest('Cada item deve ter um nome');
      if (Number(it.quantity) <= 0) return reply.badRequest('quantity deve ser > 0');
      if (Number(it.unit_price) < 0) return reply.badRequest('unit_price deve ser >= 0');
    }

    const { rows: [{ max_number }] } = await db.execute<any>(sql`
      SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS max_number FROM proposals WHERE tenant_id = ${tenantId}
    `);
    const number = String((Number(max_number) || 0) + 1).padStart(5, '0');

    const { subtotal, total } = calcProposalTotals(items, discount, shipping);

    const { rows: [p] } = await db.execute<any>(sql`
      INSERT INTO proposals (tenant_id, client_id, number, title, status,
        subtotal, discount, shipping, total, valid_until, notes, terms_text, commercial_message,
        delivery_time, payment_method, seller_email, created_by)
      VALUES (${tenantId}, ${client_id || null}, ${number}, ${title.trim()}, 'draft',
        ${subtotal}, ${Number(discount)}, ${Number(shipping)}, ${total},
        ${valid_until || null}, ${notes || null}, ${terms_text || null}, ${commercial_message || null},
        ${delivery_time || null}, ${payment_method || null},
        ${userEmail || null}, ${userId || null})
      RETURNING id, number
    `);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const lineTotal = Math.round(
        Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_pct || 0) / 100) * 100
      ) / 100;
      await db.execute(sql`
        INSERT INTO proposal_items (proposal_id, material_id, name, sku, unit, quantity, unit_price, discount_pct, total, notes, sort_order)
        VALUES (${p.id}, ${it.material_id || null}, ${it.name.trim()}, ${it.sku || null}, ${it.unit || 'UN'},
                ${Number(it.quantity)}, ${Number(it.unit_price)}, ${Number(it.discount_pct || 0)},
                ${lineTotal}, ${it.notes || null}, ${i})
      `);
    }

    return reply.status(201).send({ id: p.id, number: p.number });
  });

  // ── GET /v1/proposals/:id ─────────────────────────────────────────────
  fastify.get('/proposals/:id', { ...auth, preHandler: [requirePermission('proposals:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.*, COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email
      FROM proposals p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');

    const { rows: items } = await db.execute<any>(sql`
      SELECT * FROM proposal_items WHERE proposal_id = ${id} ORDER BY sort_order, created_at
    `);

    return { ...p, items };
  });

  // ── GET /v1/proposals/:id/print ───────────────────────────────────────
  // Mesmo formato de GET /v1/public/proposals/:token, porém autenticado por
  // tenantId (não por public_token) — funciona para qualquer status, inclusive
  // 'draft', e nunca muda status/public_viewed_at (uso interno, não é o link do cliente).
  fastify.get('/proposals/:id/print', { ...auth, preHandler: [requirePermission('proposals:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.id, p.number, p.title, p.status, p.total, p.subtotal, p.discount, p.shipping,
             p.valid_until, p.notes, p.terms_text, p.commercial_message, p.delivery_time, p.payment_method, p.accepted_at, p.accepted_by_name,
             p.rejected_at, p.rejected_reason, p.seller_email,
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
      WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');

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
        commercial_message: p.commercial_message,
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

  // ── PATCH /v1/proposals/:id ───────────────────────────────────────────
  fastify.patch('/proposals/:id', { ...auth, preHandler: [requirePermission('proposals:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const { title, client_id, valid_until, notes, terms_text, commercial_message, delivery_time, payment_method, discount, shipping, items } =
      request.body as any;

    const { rows: [existing] } = await db.execute<any>(sql`
      SELECT id, status FROM proposals WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!existing) return reply.notFound('Proposal not found');
    // Editável em draft/sent/viewed — desfechos definitivos (accepted/rejected/
    // expired/cancelled) nunca podem ser reescritos depois que o cliente já
    // decidiu sobre o conteúdo que viu. Reeditar não força reenvio nem muda o
    // status atual.
    if (!['draft', 'sent', 'viewed'].includes(existing.status))
      return reply.badRequest('Esta proposta não pode mais ser editada');

    if (items !== undefined) {
      if (!Array.isArray(items) || !items.length) return reply.badRequest('Ao menos um item é necessário');
      await db.execute(sql`DELETE FROM proposal_items WHERE proposal_id = ${id}`);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const lineTotal = Math.round(
          Number(it.quantity) * Number(it.unit_price) * (1 - Number(it.discount_pct || 0) / 100) * 100
        ) / 100;
        await db.execute(sql`
          INSERT INTO proposal_items (proposal_id, material_id, name, sku, unit, quantity, unit_price, discount_pct, total, notes, sort_order)
          VALUES (${id}, ${it.material_id || null}, ${it.name.trim()}, ${it.sku || null}, ${it.unit || 'UN'},
                  ${Number(it.quantity)}, ${Number(it.unit_price)}, ${Number(it.discount_pct || 0)},
                  ${lineTotal}, ${it.notes || null}, ${i})
        `);
      }
    }

    const { rows: currentItems } = await db.execute<any>(sql`
      SELECT quantity, unit_price, discount_pct FROM proposal_items WHERE proposal_id = ${id}
    `);
    const { rows: [curr] } = await db.execute<any>(sql`SELECT discount, shipping FROM proposals WHERE id = ${id}`);
    const finalDiscount = discount !== undefined ? Number(discount) : Number(curr.discount);
    const finalShipping = shipping !== undefined ? Number(shipping) : Number(curr.shipping);
    const { subtotal, total } = calcProposalTotals(currentItems, finalDiscount, finalShipping);

    await db.execute(sql`
      UPDATE proposals SET
        title          = COALESCE(${title?.trim() || null}, title),
        client_id      = COALESCE(${client_id || null}, client_id),
        valid_until    = COALESCE(${valid_until || null}, valid_until),
        notes          = COALESCE(${notes || null}, notes),
        terms_text     = COALESCE(${terms_text || null}, terms_text),
        commercial_message = COALESCE(${commercial_message || null}, commercial_message),
        delivery_time  = COALESCE(${delivery_time || null}, delivery_time),
        payment_method = COALESCE(${payment_method || null}, payment_method),
        discount    = ${finalDiscount},
        shipping    = ${finalShipping},
        subtotal    = ${subtotal},
        total       = ${total},
        updated_at  = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);

    return { ok: true };
  });

  // ── POST /v1/proposals/:id/send ───────────────────────────────────────
  fastify.post('/proposals/:id/send', { ...auth, preHandler: [requirePermission('proposals:send')] }, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const { id }    = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.*, COALESCE(c.company_name, c.full_name) AS client_name, c.email AS client_email,
             COALESCE(t.trade_name, t.company_name) AS tenant_name, t.logo_url AS issuer_logo
      FROM proposals p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN tenants  t ON t.id = p.tenant_id
      WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');
    if (!['draft'].includes(p.status)) return reply.badRequest('Apenas propostas em rascunho podem ser enviadas');
    if (!p.client_email) return reply.badRequest('O cliente não possui e-mail cadastrado');

    const token = p.public_token || generatePublicToken();
    const appUrl = process.env.APP_URL || 'https://www.orquestraerp.com.br';
    const proposalLink = `${appUrl}/p/${token}`;

    await db.execute(sql`
      UPDATE proposals SET status = 'sent', public_token = ${token} WHERE id = ${id}
    `);

    fastify.log.info({ event: 'proposal_send_email', proposal_id: id, recipient: p.client_email,
      queue_url_set: !!process.env.NOTIFICATIONS_QUEUE_URL });

    sendSystemNotification({
      tenant_id: tenantId,
      type:      'proposal_sent',
      from_name: p.tenant_name ?? undefined,
      recipient: { email: p.client_email, name: p.client_name ?? '' },
      data: {
        client_name:     p.client_name   ?? 'Cliente',
        proposal_number: p.number,
        proposal_title:  p.title,
        issuer_name:     p.tenant_name   ?? 'Orquestra ERP',
        issuer_logo:     p.issuer_logo   ?? '',
        proposal_link:   proposalLink,
        valid_until:     p.valid_until   ?? '',
        total:           Number(p.total).toFixed(2),
      },
    }).catch(err => fastify.log.error({ event: 'proposal_email_error', error: String(err) }));

    // WhatsApp — Cobranças e Notificações: canal independente do e-mail, não
    // bloqueado pela exigência de p.client_email acima. Fire-and-forget.
    void notifyProposalSent(tenantId, { id, client_id: p.client_id, number: p.number });

    return { ok: true, token, link: proposalLink };
  });

  // ── POST /v1/proposals/:id/convert ───────────────────────────────────
  fastify.post('/proposals/:id/convert', { ...auth, preHandler: [requirePermission('proposals:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.id;
    const { id }   = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT p.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM proposals p LEFT JOIN clients c ON c.id = p.client_id
      WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');
    if (!['accepted','sent','viewed'].includes(p.status))
      return reply.badRequest('Proposta precisa estar aceita ou enviada para converter em pedido');
    if (p.converted_to_order_id) return reply.badRequest('Esta proposta já foi convertida em pedido');
    if (!p.client_id) return reply.badRequest('Proposta sem cliente não pode ser convertida');

    const { rows: [{ max_order }] } = await db.execute<any>(sql`
      SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS max_order FROM orders WHERE tenant_id = ${tenantId}
    `);
    const orderNumber = String((Number(max_order) || 0) + 1).padStart(5, '0');

    const { rows: propItems } = await db.execute<any>(sql`
      SELECT * FROM proposal_items WHERE proposal_id = ${id} ORDER BY sort_order, created_at
    `);

    const { rows: [newOrder] } = await db.execute<any>(sql`
      INSERT INTO orders (tenant_id, client_id, number, status, subtotal, discount, shipping, total, notes, created_by)
      VALUES (${tenantId}, ${p.client_id}, ${orderNumber}, 'draft',
              ${Number(p.subtotal)}, ${Number(p.discount)}, ${Number(p.shipping)}, ${Number(p.total)},
              ${'Convertido da proposta ' + p.number}, ${userId || null})
      RETURNING id, number
    `);

    for (const it of propItems) {
      const lineTotal = Number(it.quantity) * Number(it.unit_price);
      await db.execute(sql`
        INSERT INTO order_items (order_id, material_id, name, sku, unit, quantity, unit_price, total, notes)
        VALUES (${newOrder.id}, ${it.material_id || null}, ${it.name}, ${it.sku || null}, ${it.unit},
                ${Number(it.quantity)}, ${Number(it.unit_price)}, ${lineTotal}, ${it.notes || null})
      `);
    }

    await db.execute(sql`
      UPDATE proposals SET converted_to_order_id = ${newOrder.id} WHERE id = ${id}
    `);

    return reply.status(201).send({ order_id: newOrder.id, order_number: newOrder.number });
  });

  // ── POST /v1/proposals/:id/duplicate ─────────────────────────────────
  fastify.post('/proposals/:id/duplicate', { ...auth, preHandler: [requirePermission('proposals:create')] }, async (request, reply) => {
    const tenantId  = (request as any).user.tenantId;
    const userId    = (request as any).user.id;
    const userEmail = (request as any).user.email;
    const { id }    = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT * FROM proposals WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');

    const { rows: [{ max_number }] } = await db.execute<any>(sql`
      SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS max_number FROM proposals WHERE tenant_id = ${tenantId}
    `);
    const newNumber = String((Number(max_number) || 0) + 1).padStart(5, '0');

    const { rows: [newP] } = await db.execute<any>(sql`
      INSERT INTO proposals (tenant_id, client_id, number, title, status,
        subtotal, discount, shipping, total, valid_until, notes, terms_text, commercial_message,
        delivery_time, payment_method, seller_email, created_by)
      VALUES (${tenantId}, ${p.client_id || null}, ${newNumber}, ${p.title}, 'draft',
        ${Number(p.subtotal)}, ${Number(p.discount)}, ${Number(p.shipping)}, ${Number(p.total)},
        ${p.valid_until || null}, ${p.notes || null}, ${p.terms_text || null}, ${p.commercial_message || null},
        ${p.delivery_time || null}, ${p.payment_method || null},
        ${userEmail || null}, ${userId || null})
      RETURNING id, number
    `);

    const { rows: items } = await db.execute<any>(sql`
      SELECT * FROM proposal_items WHERE proposal_id = ${id} ORDER BY sort_order, created_at
    `);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await db.execute(sql`
        INSERT INTO proposal_items (proposal_id, material_id, name, sku, unit, quantity, unit_price, discount_pct, total, notes, sort_order)
        VALUES (${newP.id}, ${it.material_id || null}, ${it.name}, ${it.sku || null}, ${it.unit},
                ${Number(it.quantity)}, ${Number(it.unit_price)}, ${Number(it.discount_pct)},
                ${Number(it.total)}, ${it.notes || null}, ${i})
      `);
    }

    return reply.status(201).send({ id: newP.id, number: newP.number });
  });

  // ── POST /v1/proposals/:id/cancel ────────────────────────────────────
  fastify.post('/proposals/:id/cancel', { ...auth, preHandler: [requirePermission('proposals:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const { rows: [p] } = await db.execute<any>(sql`
      SELECT status FROM proposals WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!p) return reply.notFound('Proposal not found');
    if (['accepted','cancelled'].includes(p.status))
      return reply.badRequest('Esta proposta não pode ser cancelada');

    await db.execute(sql`UPDATE proposals SET status = 'cancelled' WHERE id = ${id} AND tenant_id = ${tenantId}`);
    return { ok: true };
  });
};
