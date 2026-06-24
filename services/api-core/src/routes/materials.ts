import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db, materials, inventory, inventoryMovements } from '../db';

const materialBody = {
  type: 'object',
  properties: {
    sku: { type: 'string', minLength: 1, maxLength: 100 }, name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: 'string' }, type: { type: 'string', enum: ['product', 'service', 'raw_material', 'asset'] },
    category: { type: 'string', maxLength: 100 }, brand: { type: 'string', maxLength: 100 },
    unit: { type: 'string', maxLength: 20, default: 'UN' },
    sale_price: { type: 'number', minimum: 0 }, cost_price: { type: 'number', minimum: 0 },
    ncm_code: { type: 'string', maxLength: 10 }, tax_group: { type: 'string', maxLength: 50 },
    weight_kg: { type: 'number', minimum: 0 }, is_active: { type: 'boolean' },
    tracks_inventory: { type: 'boolean' },
  },
} as const;

const idParam = {
  type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'],
} as const;

export const materialsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // POST /v1/materials
  app.post('/materials', {
    schema: { body: { ...materialBody, required: ['sku', 'name'] } },
  }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const tenantId = (b.tenant_id as string) ?? null;
    if (!tenantId) return reply.badRequest('tenant_id is required');

    const tracksInventory = b.tracks_inventory !== undefined
      ? Boolean(b.tracks_inventory) : (b.type !== 'service');

    try {
      const material = await db.transaction(async (tx) => {
        const [mat] = await tx.insert(materials).values({
          tenant_id: tenantId,
          sku: b.sku as string, name: b.name as string,
          description:  (b.description  ?? null) as string | null,
          type:         (b.type         ?? 'product') as string,
          category:     (b.category     ?? null) as string | null,
          brand:        (b.brand        ?? null) as string | null,
          unit:         (b.unit         ?? 'UN') as string,
          sale_price:   String(b.sale_price ?? 0),
          cost_price:   String(b.cost_price ?? 0),
          ncm_code:     (b.ncm_code     ?? null) as string | null,
          tax_group:    (b.tax_group    ?? null) as string | null,
          weight_kg:    (b.weight_kg    != null ? String(b.weight_kg) : null) as string | null,
          is_active:        b.is_active !== false,
          tracks_inventory: tracksInventory,
        }).returning();

        if (tracksInventory) {
          await tx.insert(inventory).values({
            tenant_id: tenantId, material_id: mat.id,
            quantity: '0', min_qty: '0',
          }).onConflictDoNothing();
        }
        return mat;
      });
      return reply.status(201).send(material);
    } catch (err: any) {
      if (err.constraint === 'materials_tenant_id_sku_key')
        return reply.conflict(`SKU '${b.sku}' already exists for this tenant`);
      throw err;
    }
  });

  // POST /v1/materials/import
  app.post('/materials/import', {
    schema: {
      body: {
        type: 'object', required: ['tenant_id', 'materials'],
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          materials: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', additionalProperties: true } },
        },
      },
    },
  }, async (request) => {
    const { tenant_id, materials: rows } =
      request.body as { tenant_id: string; materials: Record<string, unknown>[] };

    const toStr  = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null; };
    const toNum  = (v: unknown): number | null => { const n = parseFloat(String(v ?? '')); return isFinite(n) ? n : null; };
    const toBool = (v: unknown): boolean => {
      const s = String(v ?? '').trim().toUpperCase();
      return s === 'SIM' || s === 'S' || s === '1' || s === 'TRUE';
    };
    const VALID_TYPES = new Set(['product', 'service', 'raw_material', 'asset']);

    let imported = 0; let skipped = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const b = rows[i]; const row = i + 2;
      const sku  = toStr(b.sku);
      const name = toStr(b.nome);
      if (!sku)  { errors.push({ row, message: 'Coluna "sku" é obrigatória' });  skipped++; continue; }
      if (!name) { errors.push({ row, message: 'Coluna "nome" é obrigatória' }); skipped++; continue; }

      const rawType    = String(b.tipo ?? '').trim().toLowerCase().replace(' ', '_');
      const type       = VALID_TYPES.has(rawType) ? rawType : 'product';
      const rawCtrl    = b.controla_estoque;
      const tracksInv  = rawCtrl !== undefined && rawCtrl !== null && String(rawCtrl).trim() !== ''
        ? toBool(rawCtrl) : type !== 'service';

      try {
        await db.transaction(async (tx) => {
          const inserted = await tx.insert(materials).values({
            tenant_id, sku, name,
            description: toStr(b.descricao), type, category: toStr(b.categoria),
            brand: toStr(b.marca), unit: toStr(b.unidade) || 'UN',
            sale_price: String(toNum(b.preco_venda) ?? 0),
            cost_price: String(toNum(b.preco_custo) ?? 0),
            ncm_code: toStr(b.ncm),
            weight_kg: toNum(b.peso_kg) != null ? String(toNum(b.peso_kg)) : null,
            is_active: true, tracks_inventory: tracksInv,
          } as any).onConflictDoNothing().returning({ id: materials.id });

          if (!inserted.length) {
            errors.push({ row, message: `SKU '${sku}' já cadastrado` }); skipped++;
            return;
          }
          if (tracksInv) {
            await tx.insert(inventory).values({
              tenant_id, material_id: inserted[0].id, quantity: '0', min_qty: '0',
            }).onConflictDoNothing();
          }
          imported++;
        });
      } catch (err) {
        errors.push({ row, message: err instanceof Error ? err.message : 'Erro interno' });
        skipped++;
      }
    }
    return { imported, skipped, errors };
  });

  // GET /v1/materials
  app.get('/materials', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          page:     { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500, default: 20 },
          type:     { type: 'string', enum: ['product', 'service', 'raw_material', 'asset'] },
          category: { type: 'string' }, active: { type: 'boolean' }, search: { type: 'string' },
        },
        required: ['tenant_id'],
      },
    },
  }, async (request, reply) => {
    const { tenant_id, page = 1, per_page = 20, type, category, active, search } =
      request.query as Record<string, unknown>;

    const conditions: any[] = [eq(materials.tenant_id, tenant_id as string)];
    if (type)     conditions.push(eq(materials.type, type as string));
    if (category) conditions.push(eq(materials.category, category as string));
    if (active !== undefined) conditions.push(eq(materials.is_active, active as boolean));
    if (search) conditions.push(or(
      ilike(materials.name, `%${search}%`),
      ilike(materials.sku,  `%${search}%`),
      ilike(materials.description, `%${search}%`),
    ));
    const where  = and(...conditions as [any, ...any[]]);
    const offset = (Number(page) - 1) * Number(per_page);

    const [[{ count }], data] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)::int` }).from(materials).where(where),
      db.select().from(materials).where(where)
        .orderBy(sql`${materials.name} ASC`)
        .limit(Number(per_page)).offset(offset),
    ]);

    return reply.send({
      data,
      meta: { total: count, page: Number(page), per_page: Number(per_page), pages: Math.ceil(count / Number(per_page)) },
    });
  });

  // GET /v1/materials/:id
  app.get('/materials/:id', { schema: { params: idParam } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(materials).where(eq(materials.id, id));
    if (!row) return reply.notFound('Material not found');
    return reply.send(row);
  });

  // PATCH /v1/materials/:id
  app.patch('/materials/:id', { schema: { params: idParam, body: materialBody } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;
    const allowed = ['sku','name','description','type','category','brand','unit',
                     'sale_price','cost_price','ncm_code','tax_group','weight_kg',
                     'is_active','tracks_inventory'];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updateData).length) return reply.badRequest('No valid fields to update');

    const [row] = await db.update(materials)
      .set({ ...updateData as any, updated_at: new Date() })
      .where(eq(materials.id, id))
      .returning();
    if (!row) return reply.notFound('Material not found');
    return reply.send(row);
  });

  // DELETE /v1/materials/:id
  app.delete('/materials/:id', { schema: { params: idParam } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.update(materials)
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(materials.id, id))
      .returning();
    if (!row) return reply.notFound('Material not found');
    return reply.send(row);
  });

  // GET /v1/materials/:id/stock
  app.get('/materials/:id/stock', { schema: { params: idParam } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db.execute<{
      material_id: string; quantity: string; min_qty: string; max_qty: string | null;
      is_low_stock: boolean; updated_at: string;
    }>(sql`
      SELECT i.material_id, i.quantity, i.min_qty, i.max_qty,
             (i.quantity <= i.min_qty) AS is_low_stock, i.updated_at
      FROM inventory i
      JOIN materials m ON m.id = i.material_id
      WHERE i.material_id = ${id}
    `);
    if (!rows.rows[0]) return reply.notFound('Inventory record not found — material may not track stock');
    return reply.send(rows.rows[0]);
  });

  // POST /v1/materials/:id/stock/movements
  app.post('/materials/:id/stock/movements', {
    schema: {
      params: idParam,
      body: {
        type: 'object', required: ['movement_type', 'quantity'],
        properties: {
          movement_type:  { type: 'string', enum: ['in', 'out', 'adjustment', 'return', 'transfer'] },
          quantity:       { type: 'number', minimum: 0.001 },
          reason:         { type: 'string' }, reference_id: { type: 'string', format: 'uuid' },
          reference_type: { type: 'string', maxLength: 50 }, created_by: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id: materialId } = request.params as { id: string };
    const b = request.body as {
      movement_type: string; quantity: number; reason?: string;
      reference_id?: string; reference_type?: string; created_by?: string;
    };
    const delta = b.movement_type === 'out' ? -Math.abs(b.quantity) : Math.abs(b.quantity);

    const [existing] = await db.select({ id: inventory.id }).from(inventory).where(eq(inventory.material_id, materialId));
    if (!existing) return reply.notFound('Inventory record not found — material may not track stock');

    let movement: any;
    try {
      await db.transaction(async (tx) => {
        const { rows: [inv] } = await tx.execute<{ id: string; quantity: string; tenant_id: string }>(sql`
          SELECT id, quantity, tenant_id FROM inventory WHERE material_id = ${materialId} FOR UPDATE
        `);

        const before = Number(inv.quantity);
        const after  = before + delta;

        if (b.movement_type === 'out' && after < 0)
          throw Object.assign(new Error(`Insufficient stock: available ${before}, requested ${b.quantity}`), { isInsufficient: true });

        await tx.update(inventory)
          .set({ quantity: String(after), updated_at: new Date() })
          .where(eq(inventory.id, inv.id));

        const { rows: [mov] } = await tx.execute<any>(sql`
          INSERT INTO inventory_movements
            (tenant_id, material_id, movement_type, quantity, quantity_before, quantity_after,
             reason, reference_id, reference_type, created_by)
          SELECT tenant_id, ${materialId}, ${b.movement_type}, ${delta}, ${before}, ${after},
                 ${b.reason ?? null}, ${b.reference_id ?? null}, ${b.reference_type ?? null}, ${b.created_by ?? null}
          FROM inventory WHERE material_id = ${materialId}
          RETURNING *
        `);
        movement = mov;
      });
    } catch (err: any) {
      if (err.isInsufficient) return reply.badRequest(err.message);
      throw err;
    }
    return reply.status(201).send(movement);
  });

  // GET /v1/materials/:id/stock/movements
  app.get('/materials/:id/stock/movements', {
    schema: {
      params: idParam,
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          type: { type: 'string', enum: ['in','out','adjustment','return','transfer'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = 1, per_page = 20, type } = request.query as Record<string, unknown>;

    const conditions: any[] = [eq(inventoryMovements.material_id, id)];
    if (type) conditions.push(eq(inventoryMovements.movement_type, type as string));
    const where = and(...conditions as [any, ...any[]]);
    const offset = (Number(page) - 1) * Number(per_page);

    const [[{ count }], data] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)::int` }).from(inventoryMovements).where(where),
      db.select().from(inventoryMovements).where(where)
        .orderBy(sql`${inventoryMovements.created_at} DESC`)
        .limit(Number(per_page)).offset(offset),
    ]);

    return reply.send({
      data,
      meta: { total: count, page: Number(page), per_page: Number(per_page), pages: Math.ceil(count / Number(per_page)) },
    });
  });

  // GET /v1/stock/alerts
  app.get('/stock/alerts', {
    schema: { querystring: { type: 'object', required: ['tenant_id'], properties: { tenant_id: { type: 'string', format: 'uuid' } } } },
  }, async (request, reply) => {
    const { tenant_id } = request.query as { tenant_id: string };
    const { rows: data } = await db.execute<any>(sql`
      SELECT m.id, m.sku, m.name, m.unit, m.category,
             i.quantity, i.min_qty, i.max_qty,
             (i.min_qty - i.quantity) AS shortage
      FROM inventory i
      JOIN materials m ON m.id = i.material_id
      WHERE i.tenant_id = ${tenant_id}
        AND i.quantity <= i.min_qty
        AND m.is_active = true
      ORDER BY shortage DESC, m.name
    `);
    return reply.send({ data, meta: { total: data.length } });
  });

  // GET /v1/stock — visão consolidada de estoque de todos os materiais (usa JWT)
  app.get('/stock', { onRequest: [(app as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const searchFilter = search
      ? sql`AND (m.name ILIKE ${'%' + search + '%'} OR m.sku ILIKE ${'%' + search + '%'})`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT m.id, m.sku, m.name, m.type, m.category, m.unit,
               m.sale_price, m.cost_price, m.is_active,
               i.quantity, i.min_qty, i.max_qty,
               (i.quantity <= i.min_qty) AS is_low_stock
        FROM inventory i
        JOIN materials m ON m.id = i.material_id
        WHERE i.tenant_id = ${tenantId} AND m.is_active = true
          ${searchFilter}
        ORDER BY m.name ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM inventory i
        JOIN materials m ON m.id = i.material_id
        WHERE i.tenant_id = ${tenantId} AND m.is_active = true
          ${searchFilter}
      `),
    ]);

    return reply.send({ data: rows, total: Number(cnt.count), page: Number(page), per_page: limit });
  });

  // GET /v1/stock/movements — histórico global de movimentos (usa JWT)
  app.get('/stock/movements', { onRequest: [(app as any).authenticate] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { material_id, movement_type, date_from, date_to,
            page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const matFilter  = material_id    ? sql`AND im.material_id = ${material_id}::uuid` : sql``;
    const typeFilter = movement_type  ? sql`AND im.movement_type = ${movement_type}` : sql``;
    const dateFrom   = date_from      ? sql`AND im.created_at >= ${date_from}::timestamptz` : sql``;
    const dateTo     = date_to        ? sql`AND im.created_at < (${date_to}::date + interval '1 day')::timestamptz` : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT im.id, im.movement_type, im.quantity, im.quantity_before, im.quantity_after,
               im.reason, im.reference_id, im.reference_type, im.created_at,
               m.id AS material_id, m.sku, m.name AS material_name, m.unit
        FROM inventory_movements im
        JOIN materials m ON m.id = im.material_id
        WHERE im.tenant_id = ${tenantId}
          ${matFilter} ${typeFilter} ${dateFrom} ${dateTo}
        ORDER BY im.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count
        FROM inventory_movements im
        WHERE im.tenant_id = ${tenantId}
          ${matFilter} ${typeFilter} ${dateFrom} ${dateTo}
      `),
    ]);

    return reply.send({ data: rows, total: Number(cnt.count), page: Number(page), per_page: limit });
  });
};
