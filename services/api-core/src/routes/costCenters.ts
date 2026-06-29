import { FastifyPluginAsync } from 'fastify';
import { eq, ilike, and, sql } from 'drizzle-orm';
import { db, costCenters, costCenterStock, costCenterMovements, materials } from '../db';
import {
  applyEntry,
  applyAdjustment,
  DomainError,
} from '../services/costCenterStock';

export const costCentersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/cost-centers ───────────────────────────────────────────────── */
  fastify.get('/cost-centers', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, is_active, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [eq(costCenters.tenant_id, tenantId)];

    if (is_active !== undefined) {
      conditions.push(eq(costCenters.is_active, is_active !== 'false'));
    }

    const searchFilter = search
      ? sql`AND (cc.name ILIKE ${'%' + search + '%'} OR cc.code ILIKE ${'%' + search + '%'})`
      : sql``;

    const isActiveFilter = is_active !== undefined
      ? sql`AND cc.is_active = ${is_active !== 'false'}`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT cc.id, cc.code, cc.name, cc.description, cc.allow_negative, cc.is_active, cc.created_at, cc.updated_at
        FROM cost_centers cc
        WHERE cc.tenant_id = ${tenantId}
          ${isActiveFilter} ${searchFilter}
        ORDER BY cc.code ASC, cc.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM cost_centers cc
        WHERE cc.tenant_id = ${tenantId}
          ${isActiveFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── GET /v1/cost-centers/active ────────────────────────────────────────── */
  fastify.get('/cost-centers/active', { onRequest: [(fastify as any).authenticate] }, async (request) => {
    const tenantId = (request as any).user.tenantId;

    const { rows } = await db.execute<any>(sql`
      SELECT id, code, name
      FROM cost_centers
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY code ASC, name ASC
    `);

    return rows;
  });

  /* ── POST /v1/cost-centers ──────────────────────────────────────────────── */
  fastify.post('/cost-centers', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { code, name, description, allow_negative = false } = request.body as any;

    if (!code || typeof code !== 'string' || !code.trim())
      return reply.badRequest('code é obrigatório');
    if (!name || typeof name !== 'string' || !name.trim())
      return reply.badRequest('name é obrigatório');

    const [existing] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.tenant_id, tenantId), eq(costCenters.code, code.trim())));

    if (existing) return reply.conflict('code já existe para este tenant');

    const [row] = await db.insert(costCenters).values({
      tenant_id:      tenantId,
      code:           code.trim(),
      name:           name.trim(),
      description:    description || null,
      allow_negative: Boolean(allow_negative),
      is_active:      true,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/cost-centers/:id ───────────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/cost-centers/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;

    const [cc] = await db
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!cc) return reply.notFound('Centro de custo não encontrado');
    return cc;
  });

  /* ── PATCH /v1/cost-centers/:id ─────────────────────────────────────────── */
  fastify.patch<{ Params: { id: string } }>('/cost-centers/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;
    const body     = request.body as any;

    const [existing] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!existing) return reply.notFound('Centro de custo não encontrado');

    const patch: Record<string, unknown> = {};
    if (body.name           !== undefined) patch.name           = body.name;
    if (body.description    !== undefined) patch.description    = body.description || null;
    if (body.is_active      !== undefined) patch.is_active      = Boolean(body.is_active);
    if (body.allow_negative !== undefined) patch.allow_negative = Boolean(body.allow_negative);

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    patch.updated_at = new Date();

    const [updated] = await db
      .update(costCenters)
      .set(patch as any)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)))
      .returning();

    return updated;
  });

  /* ── DELETE /v1/cost-centers/:id ────────────────────────────────────────── */
  fastify.delete<{ Params: { id: string } }>('/cost-centers/:id', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;

    const result = await db
      .update(costCenters)
      .set({ is_active: false, updated_at: new Date() })
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId), eq(costCenters.is_active, true)));

    if (!result.rowCount) return reply.notFound('Centro de custo não encontrado ou já inativo');
    return reply.code(204).send();
  });

  /* ── GET /v1/cost-centers/:id/stock ─────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/cost-centers/:id/stock', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;

    const [cc] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!cc) return reply.notFound('Centro de custo não encontrado');

    const { rows } = await db.execute<any>(sql`
      SELECT
        s.material_id,
        m.name AS material_name,
        s.quantity::numeric AS quantity,
        s.avg_unit_cost::numeric AS avg_unit_cost,
        (s.quantity::numeric * s.avg_unit_cost::numeric) AS total_value
      FROM cost_center_stock s
      JOIN materials m ON m.id = s.material_id
      WHERE s.cost_center_id = ${id}
        AND s.tenant_id = ${tenantId}
      ORDER BY m.name ASC
    `);

    return rows.map((r: any) => ({
      material_id:   r.material_id,
      material_name: r.material_name,
      quantity:      Number(r.quantity),
      avg_unit_cost: Number(r.avg_unit_cost),
      total_value:   Number(r.total_value),
    }));
  });

  /* ── GET /v1/cost-centers/:id/movements ─────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/cost-centers/:id/movements', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params;
    const { material_id, direction, from, to, page = '1', per_page = '20' } =
      request.query as Record<string, string>;

    const [cc] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!cc) return reply.notFound('Centro de custo não encontrado');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const materialFilter  = material_id ? sql`AND cm.material_id = ${material_id}::uuid` : sql``;
    const directionFilter = direction   ? sql`AND cm.direction = ${direction}` : sql``;
    const fromFilter      = from        ? sql`AND cm.created_at >= ${from}::timestamptz` : sql``;
    const toFilter        = to          ? sql`AND cm.created_at <= ${to}::timestamptz` : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT
          cm.id, cm.direction, cm.quantity, cm.unit_cost, cm.total_cost,
          cm.balance_after, cm.source, cm.source_id, cm.note, cm.created_at AS occurred_at,
          m.name AS material_name
        FROM cost_center_movements cm
        JOIN materials m ON m.id = cm.material_id
        WHERE cm.cost_center_id = ${id}
          AND cm.tenant_id = ${tenantId}
          ${materialFilter} ${directionFilter} ${fromFilter} ${toFilter}
        ORDER BY cm.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM cost_center_movements cm
        WHERE cm.cost_center_id = ${id}
          AND cm.tenant_id = ${tenantId}
          ${materialFilter} ${directionFilter} ${fromFilter} ${toFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/cost-centers/:id/entries ──────────────────────────────────── */
  fastify.post<{ Params: { id: string } }>('/cost-centers/:id/entries', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params;
    const { material_id, quantity, unit_cost, note } = request.body as any;

    if (!material_id) return reply.badRequest('material_id é obrigatório');
    if (!quantity || Number(quantity) <= 0) return reply.badRequest('quantity deve ser maior que zero');
    if (unit_cost === undefined || unit_cost === null || Number(unit_cost) < 0)
      return reply.badRequest('unit_cost é obrigatório e deve ser >= 0');

    const [cc] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!cc) return reply.notFound('Centro de custo não encontrado');

    try {
      const movement = await applyEntry(
        {
          tenantId,
          costCenterId: id,
          materialId:   material_id,
          quantity:     Number(quantity),
          unitCost:     Number(unit_cost),
          source:       'manual_entry',
          note:         note || undefined,
          userId:       userId || undefined,
        },
        db
      );

      return reply.code(201).send(movement);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'insufficient_stock') {
        return reply.code(422).send({
          error:     'insufficient_stock',
          available: err.payload?.available,
          requested: err.payload?.requested,
        });
      }
      throw err;
    }
  });

  /* ── POST /v1/cost-centers/:id/adjustments ───────────────────────────────── */
  fastify.post<{ Params: { id: string } }>('/cost-centers/:id/adjustments', { onRequest: [(fastify as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const userId   = (request as any).user.userId;
    const { id }   = request.params;
    const { material_id, target_quantity, note } = request.body as any;

    if (!material_id) return reply.badRequest('material_id é obrigatório');
    if (target_quantity === undefined || target_quantity === null || Number(target_quantity) < 0)
      return reply.badRequest('target_quantity é obrigatório e deve ser >= 0');

    const [cc] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.id, id), eq(costCenters.tenant_id, tenantId)));

    if (!cc) return reply.notFound('Centro de custo não encontrado');

    try {
      const movement = await applyAdjustment(
        {
          tenantId,
          costCenterId:   id,
          materialId:     material_id,
          quantity:       0,           // unused — applyAdjustment derives delta from targetQuantity
          targetQuantity: Number(target_quantity),
          source:         'adjustment',
          note:           note || undefined,
          userId:         userId || undefined,
        },
        db
      );

      return reply.code(201).send(movement);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'insufficient_stock') {
        return reply.code(422).send({
          error:     'insufficient_stock',
          available: err.payload?.available,
          requested: err.payload?.requested,
        });
      }
      throw err;
    }
  });
};
