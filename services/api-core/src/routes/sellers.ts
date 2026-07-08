import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, sellers } from '../db';
import { requirePermission } from '../lib/requirePermission';

const VALID_COMMISSION_BASE = ['subtotal', 'total'] as const;

export const sellersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/sellers ────────────────────────────────────────────────────── */
  fastify.get('/sellers', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, is_active, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const activeFilter = is_active === 'all'
      ? sql``
      : is_active === 'false'
        ? sql`AND is_active = false`
        : sql`AND is_active = true`;

    const searchFilter = search
      ? sql`AND (name ILIKE ${'%' + search + '%'} OR COALESCE(email,'') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT id, name, email, phone, document, default_commission_pct, commission_base, is_active, created_at
        FROM sellers
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${searchFilter}
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM sellers
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── GET /v1/sellers/active ─────────────────────────────────────────────── */
  fastify.get('/sellers/active', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const { rows } = await db.execute<any>(sql`
      SELECT id, name
      FROM sellers
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY name ASC
    `);

    return rows;
  });

  /* ── POST /v1/sellers ───────────────────────────────────────────────────── */
  fastify.post('/sellers', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as Record<string, any>;

    if (!b.name || typeof b.name !== 'string' || !b.name.trim())
      return reply.badRequest('name é obrigatório');

    const commissionBase = b.commission_base ?? 'subtotal';
    if (!VALID_COMMISSION_BASE.includes(commissionBase))
      return reply.badRequest(`commission_base inválido. Valores aceitos: ${VALID_COMMISSION_BASE.join(', ')}`);

    const rate = b.default_commission_pct !== undefined ? Number(b.default_commission_pct) : 0;
    if (Number.isNaN(rate) || rate < 0 || rate > 100)
      return reply.badRequest('default_commission_pct deve estar entre 0 e 100');

    const [row] = await db.insert(sellers).values({
      tenant_id:               tenantId,
      user_id:                 b.user_id || null,
      name:                    b.name.trim(),
      email:                   b.email || null,
      phone:                   b.phone || null,
      document:                b.document || null,
      default_commission_pct: rate.toFixed(2),
      commission_base:         commissionBase,
      is_active:               b.is_active !== undefined ? Boolean(b.is_active) : true,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/sellers/:id ────────────────────────────────────────────────── */
  fastify.get('/sellers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [seller] = await db.select().from(sellers)
      .where(and(eq(sellers.id, id), eq(sellers.tenant_id, tenantId)));

    if (!seller) return reply.notFound('Vendedor não encontrado');
    return seller;
  });

  /* ── PATCH /v1/sellers/:id ──────────────────────────────────────────────── */
  fastify.patch('/sellers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b        = request.body as Record<string, any>;

    const [existing] = await db.select({ id: sellers.id }).from(sellers)
      .where(and(eq(sellers.id, id), eq(sellers.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Vendedor não encontrado');

    if (b.commission_base !== undefined && !VALID_COMMISSION_BASE.includes(b.commission_base))
      return reply.badRequest(`commission_base inválido. Valores aceitos: ${VALID_COMMISSION_BASE.join(', ')}`);

    if (b.default_commission_pct !== undefined) {
      const rate = Number(b.default_commission_pct);
      if (Number.isNaN(rate) || rate < 0 || rate > 100)
        return reply.badRequest('default_commission_pct deve estar entre 0 e 100');
    }

    const patch: Record<string, unknown> = {};
    if (b.name             !== undefined) patch.name             = b.name;
    if (b.email             !== undefined) patch.email             = b.email || null;
    if (b.phone             !== undefined) patch.phone             = b.phone || null;
    if (b.document           !== undefined) patch.document           = b.document || null;
    if (b.user_id            !== undefined) patch.user_id            = b.user_id || null;
    if (b.commission_base    !== undefined) patch.commission_base    = b.commission_base;
    if (b.default_commission_pct !== undefined) patch.default_commission_pct = Number(b.default_commission_pct).toFixed(2);
    if (b.is_active          !== undefined) patch.is_active          = Boolean(b.is_active);

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    patch.updated_at = new Date();

    const [updated] = await db.update(sellers).set(patch as any)
      .where(and(eq(sellers.id, id), eq(sellers.tenant_id, tenantId)))
      .returning();

    return updated;
  });

  /* ── DELETE /v1/sellers/:id (soft delete) ───────────────────────────────── */
  fastify.delete('/sellers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:delete')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const result = await db.update(sellers)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(eq(sellers.id, id), eq(sellers.tenant_id, tenantId), eq(sellers.is_active, true)));

    if (!result.rowCount) return reply.notFound('Vendedor não encontrado ou já inativo');
    return reply.code(204).send();
  });

  /* ── GET /v1/sellers/:id/commissions — extrato de comissões ────────────── */
  fastify.get('/sellers/:id/commissions', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('sellers:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { status, from, to, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const [seller] = await db.select({ id: sellers.id }).from(sellers)
      .where(and(eq(sellers.id, id), eq(sellers.tenant_id, tenantId)));
    if (!seller) return reply.notFound('Vendedor não encontrado');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const statusFilter = status ? sql`AND ce.status = ${status}` : sql``;
    const fromFilter    = from   ? sql`AND ce.created_at >= ${from}::timestamptz` : sql``;
    const toFilter      = to     ? sql`AND ce.created_at <= ${to}::timestamptz`   : sql``;

    const [{ rows }, { rows: [cnt] }, { rows: [summary] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT
          ce.id, ce.invoice_id, ce.order_id, ce.base_amount, ce.rate, ce.commission_amount,
          ce.status, ce.created_at, ce.cancelled_at,
          i.number AS invoice_number, i.issue_date,
          COALESCE(c.company_name, c.full_name) AS client_name
        FROM commission_entries ce
        JOIN invoices i ON i.id = ce.invoice_id
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE ce.seller_id = ${id} AND ce.tenant_id = ${tenantId}
          ${statusFilter} ${fromFilter} ${toFilter}
        ORDER BY ce.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM commission_entries ce
        WHERE ce.seller_id = ${id} AND ce.tenant_id = ${tenantId}
          ${statusFilter} ${fromFilter} ${toFilter}
      `),
      db.execute<{ total_accrued: string; total_cancelled: string }>(sql`
        SELECT
          COALESCE(SUM(commission_amount) FILTER (WHERE status = 'accrued'),   0) AS total_accrued,
          COALESCE(SUM(commission_amount) FILTER (WHERE status = 'cancelled'), 0) AS total_cancelled
        FROM commission_entries
        WHERE seller_id = ${id} AND tenant_id = ${tenantId}
      `),
    ]);

    return {
      data:    rows,
      total:   Number(cnt.count),
      page:    Number(page),
      per_page: limit,
      summary: {
        total_accrued:   Number(summary.total_accrued),
        total_cancelled: Number(summary.total_cancelled),
      },
    };
  });
};
