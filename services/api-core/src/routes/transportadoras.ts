// Transportadora (migration 0089) — catálogo core por tenant (sem gate de
// módulo, mesmo precedente de payment_plans/regra 75), usado no grupo
// transporta da NF-e/Simples Remessa. Mesmo molde CRUD de routes/sellers.ts.

import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, transportadoras } from '../db';
import { requirePermission } from '../lib/requirePermission';
import { validateTransportadora, normalizeDocument, TransportadoraDomainError } from '../domain/transportadora/transportadoraDomain';

export const transportadorasRoutes: FastifyPluginAsync = async (fastify) => {

  const handleDomainError = (err: unknown, reply: any) => {
    if (err instanceof TransportadoraDomainError) return reply.code(422).send({ error: err.code, ...err.payload });
    throw err;
  };

  /* ── GET /v1/transportadoras ─────────────────────────────────────────── */
  fastify.get('/transportadoras', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:view')] }, async (request) => {
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
      ? sql`AND (name ILIKE ${'%' + search + '%'} OR COALESCE(document,'') ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT id, person_type, name, document, state_reg, rntc, city, state, phone, email, is_active, created_at
        FROM transportadoras
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${searchFilter}
        ORDER BY name ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM transportadoras
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── GET /v1/transportadoras/active ──────────────────────────────────── */
  // Alimenta o <select> de transportadora na nota/remessa — mesmo padrão de
  // /sellers/active, /cost-centers/active, /payment-plans/active.
  fastify.get('/transportadoras/active', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const { rows } = await db.execute<any>(sql`
      SELECT id, name, person_type
      FROM transportadoras
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY name ASC
    `);

    return { data: rows };
  });

  /* ── POST /v1/transportadoras ────────────────────────────────────────── */
  fastify.post('/transportadoras', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as Record<string, any>;

    const personType = (b.person_type ?? 'PJ') as 'PJ' | 'PF';
    try {
      validateTransportadora({ name: b.name, person_type: personType, document: b.document });
    } catch (err) {
      return handleDomainError(err, reply);
    }

    const [row] = await db.insert(transportadoras).values({
      tenant_id:     tenantId,
      person_type:   personType,
      name:          String(b.name).trim(),
      document:      b.document ? normalizeDocument(b.document, personType) : null,
      state_reg:     b.state_reg || null,
      rntc:          b.rntc || null,
      street:        b.street || null,
      street_number: b.street_number || null,
      complement:    b.complement || null,
      neighborhood:  b.neighborhood || null,
      city:          b.city || null,
      state:         b.state || null,
      zip_code:      b.zip_code || null,
      phone:         b.phone || null,
      email:         b.email || null,
      is_active:     b.is_active !== undefined ? Boolean(b.is_active) : true,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/transportadoras/:id ─────────────────────────────────────── */
  fastify.get('/transportadoras/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [row] = await db.select().from(transportadoras)
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenant_id, tenantId)));

    if (!row) return reply.notFound('Transportadora não encontrada');
    return row;
  });

  /* ── PATCH /v1/transportadoras/:id ───────────────────────────────────── */
  fastify.patch('/transportadoras/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b        = request.body as Record<string, any>;

    const [existing] = await db.select().from(transportadoras)
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Transportadora não encontrada');

    const personType = (b.person_type ?? existing.person_type) as 'PJ' | 'PF';
    const nextName    = b.name !== undefined ? b.name : existing.name;
    const nextDocument = b.document !== undefined ? b.document : existing.document;
    try {
      validateTransportadora({ name: nextName, person_type: personType, document: nextDocument });
    } catch (err) {
      return handleDomainError(err, reply);
    }

    const patch: Record<string, unknown> = {};
    if (b.person_type   !== undefined) patch.person_type   = b.person_type;
    if (b.name           !== undefined) patch.name           = String(b.name).trim();
    if (b.document        !== undefined) patch.document        = b.document ? normalizeDocument(b.document, personType) : null;
    if (b.state_reg       !== undefined) patch.state_reg       = b.state_reg || null;
    if (b.rntc             !== undefined) patch.rntc             = b.rntc || null;
    if (b.street           !== undefined) patch.street           = b.street || null;
    if (b.street_number    !== undefined) patch.street_number    = b.street_number || null;
    if (b.complement       !== undefined) patch.complement       = b.complement || null;
    if (b.neighborhood     !== undefined) patch.neighborhood     = b.neighborhood || null;
    if (b.city              !== undefined) patch.city              = b.city || null;
    if (b.state              !== undefined) patch.state              = b.state || null;
    if (b.zip_code           !== undefined) patch.zip_code           = b.zip_code || null;
    if (b.phone               !== undefined) patch.phone               = b.phone || null;
    if (b.email                !== undefined) patch.email                = b.email || null;
    if (b.is_active             !== undefined) patch.is_active             = Boolean(b.is_active);

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    patch.updated_at = new Date();

    const [updated] = await db.update(transportadoras).set(patch as any)
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenant_id, tenantId)))
      .returning();

    return updated;
  });

  /* ── DELETE /v1/transportadoras/:id (soft delete) ────────────────────── */
  fastify.delete('/transportadoras/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('transportadoras:delete')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const result = await db.update(transportadoras)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(eq(transportadoras.id, id), eq(transportadoras.tenant_id, tenantId), eq(transportadoras.is_active, true)));

    if (!result.rowCount) return reply.notFound('Transportadora não encontrada ou já inativa');
    return reply.code(204).send();
  });
};
