import { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { sendSystemNotification } from '../lib/notificationsClient';

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
  fastify.get('/proposals', auth, async (request) => {
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
  fastify.post('/proposals', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userEmail = (request as any).user.email;
    const userId    = (request as any).user.id;
    const { client_id, title, valid_until, notes, terms_text, delivery_time, payment_method, discount = 0, shipping = 0, items } =
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
        subtotal, discount, shipping, total, valid_until, notes, terms_text,
        delivery_time, payment_method, seller_email, created_by)
      VALUES (${tenantId}, ${client_id || null}, ${number}, ${title.trim()}, 'draft',
        ${subtotal}, ${Number(discount)}, ${Number(shipping)}, ${total},
        ${valid_until || null}, ${notes || null}, ${terms_text || null},
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
  fastify.get('/proposals/:id', auth, async (request, reply) => {
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

  // ── PATCH /v1/proposals/:id ───────────────────────────────────────────
  fastify.patch('/proposals/:id', auth, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id } = request.params as { id: string };
    const { title, client_id, valid_until, notes, terms_text, delivery_time, payment_method, discount, shipping, items } =
      request.body as any;

    const { rows: [existing] } = await db.execute<any>(sql`
      SELECT id, status FROM proposals WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!existing) return reply.notFound('Proposal not found');
    if (!['draft'].includes(existing.status))
      return reply.badRequest('Apenas propostas em rascunho podem ser editadas');

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
  fastify.post('/proposals/:id/send', auth, async (request, reply) => {
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

    return { ok: true, token, link: proposalLink };
  });

  // ── POST /v1/proposals/:id/convert ───────────────────────────────────
  fastify.post('/proposals/:id/convert', auth, async (request, reply) => {
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
  fastify.post('/proposals/:id/duplicate', auth, async (request, reply) => {
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
        subtotal, discount, shipping, total, valid_until, notes, terms_text,
        delivery_time, payment_method, seller_email, created_by)
      VALUES (${tenantId}, ${p.client_id || null}, ${newNumber}, ${p.title}, 'draft',
        ${Number(p.subtotal)}, ${Number(p.discount)}, ${Number(p.shipping)}, ${Number(p.total)},
        ${p.valid_until || null}, ${p.notes || null}, ${p.terms_text || null},
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
  fastify.post('/proposals/:id/cancel', auth, async (request, reply) => {
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
