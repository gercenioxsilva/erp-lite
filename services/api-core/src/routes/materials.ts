import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';

// ── Shared schema fragments ───────────────────────────────────────────────────

const materialBody = {
  type: 'object',
  properties: {
    sku:         { type: 'string', minLength: 1, maxLength: 100 },
    name:        { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: 'string' },
    type:        { type: 'string', enum: ['product', 'service', 'raw_material', 'asset'] },
    category:    { type: 'string', maxLength: 100 },
    brand:       { type: 'string', maxLength: 100 },
    unit:        { type: 'string', maxLength: 20, default: 'UN' },
    sale_price:  { type: 'number', minimum: 0 },
    cost_price:  { type: 'number', minimum: 0 },
    ncm_code:    { type: 'string', maxLength: 10 },
    tax_group:   { type: 'string', maxLength: 50 },
    weight_kg:   { type: 'number', minimum: 0 },
    is_active:        { type: 'boolean' },
    tracks_inventory: { type: 'boolean' },
  },
} as const;

const materialResponse = {
  type: 'object',
  properties: {
    id:          { type: 'string' },
    tenant_id:   { type: 'string' },
    sku:         { type: 'string' },
    name:        { type: 'string' },
    description: { type: ['string', 'null'] },
    type:        { type: 'string' },
    category:    { type: ['string', 'null'] },
    brand:       { type: ['string', 'null'] },
    unit:        { type: 'string' },
    sale_price:  { type: 'number' },
    cost_price:  { type: 'number' },
    ncm_code:    { type: ['string', 'null'] },
    tax_group:   { type: ['string', 'null'] },
    weight_kg:   { type: ['number', 'null'] },
    is_active:        { type: 'boolean' },
    tracks_inventory: { type: 'boolean' },
    created_at:  { type: 'string' },
    updated_at:  { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const;

// ── Plugin ────────────────────────────────────────────────────────────────────

export const materialsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // POST /v1/materials — create material
  app.post('/materials', {
    schema: {
      body: { ...materialBody, required: ['sku', 'name'] },
      response: { 201: materialResponse },
    },
  }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;

    // tenant_id will come from JWT once auth is in place;
    // for now accept it from the body so the API is testable end-to-end
    const tenantId = (b.tenant_id as string) ?? null;
    if (!tenantId) return reply.badRequest('tenant_id is required');

    const tracksInventory = b.tracks_inventory !== undefined
      ? Boolean(b.tracks_inventory)
      : (b.type !== 'service');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<Record<string, unknown>>(`
        INSERT INTO materials (
          tenant_id, sku, name, description, type,
          category, brand, unit,
          sale_price, cost_price,
          ncm_code, tax_group, weight_kg,
          is_active, tracks_inventory
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
      `, [
        tenantId,
        b.sku, b.name, b.description ?? null, b.type ?? 'product',
        b.category ?? null, b.brand ?? null, b.unit ?? 'UN',
        b.sale_price ?? 0, b.cost_price ?? 0,
        b.ncm_code ?? null, b.tax_group ?? null, b.weight_kg ?? null,
        b.is_active !== false, tracksInventory,
      ]);

      const material = rows[0];

      // Auto-create inventory row for items that track stock
      if (tracksInventory) {
        await client.query(`
          INSERT INTO inventory (tenant_id, material_id, quantity, min_qty)
          VALUES ($1, $2, 0, 0)
          ON CONFLICT (tenant_id, material_id) DO NOTHING
        `, [tenantId, material.id]);
      }

      await client.query('COMMIT');
      return reply.status(201).send(material);
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.constraint === `materials_tenant_id_sku_key`) {
        return reply.conflict(`SKU '${b.sku}' already exists for this tenant`);
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /v1/materials/import — batch upsert from Excel
  app.post('/materials/import', {
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'materials'],
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          materials: {
            type: 'array', minItems: 1, maxItems: 500,
            items: { type: 'object', additionalProperties: true },
          },
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
      const b   = rows[i];
      const row = i + 2; // Excel row (1=header, 2=first data row)

      const sku  = toStr(b.sku);
      const name = toStr(b.nome);
      if (!sku)  { errors.push({ row, message: 'Coluna "sku" é obrigatória' });  skipped++; continue; }
      if (!name) { errors.push({ row, message: 'Coluna "nome" é obrigatória' }); skipped++; continue; }

      const rawType = String(b.tipo ?? '').trim().toLowerCase().replace(' ', '_');
      const type    = VALID_TYPES.has(rawType) ? rawType : 'product';

      const rawCtrl       = b.controla_estoque;
      const tracksInv     = rawCtrl !== undefined && rawCtrl !== null && String(rawCtrl).trim() !== ''
        ? toBool(rawCtrl)
        : type !== 'service';

      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        const { rows: inserted } = await dbClient.query<{ id: string }>(`
          INSERT INTO materials
            (tenant_id, sku, name, description, type, category, brand, unit,
             sale_price, cost_price, ncm_code, weight_kg, is_active, tracks_inventory)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
          ON CONFLICT (tenant_id, sku) DO NOTHING
          RETURNING id
        `, [
          tenant_id, sku, name,
          toStr(b.descricao), type,
          toStr(b.categoria), toStr(b.marca),
          toStr(b.unidade) || 'UN',
          toNum(b.preco_venda) ?? 0,
          toNum(b.preco_custo) ?? 0,
          toStr(b.ncm),
          toNum(b.peso_kg),
          tracksInv,
        ]);

        if (inserted.length === 0) {
          await dbClient.query('ROLLBACK');
          errors.push({ row, message: `SKU '${sku}' já cadastrado` });
          skipped++;
          continue;
        }

        if (tracksInv) {
          await dbClient.query(`
            INSERT INTO inventory (tenant_id, material_id, quantity, min_qty)
            VALUES ($1, $2, 0, 0)
            ON CONFLICT (tenant_id, material_id) DO NOTHING
          `, [tenant_id, inserted[0].id]);
        }

        await dbClient.query('COMMIT');
        imported++;
      } catch (err) {
        await dbClient.query('ROLLBACK');
        errors.push({ row, message: err instanceof Error ? err.message : 'Erro interno' });
        skipped++;
      } finally {
        dbClient.release();
      }
    }

    return { imported, skipped, errors };
  });

  // GET /v1/materials — paginated list
  app.get('/materials', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          page:      { type: 'integer', minimum: 1, default: 1 },
          per_page:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          type:      { type: 'string', enum: ['product', 'service', 'raw_material', 'asset'] },
          category:  { type: 'string' },
          active:    { type: 'boolean' },
          search:    { type: 'string' },
        },
        required: ['tenant_id'],
      },
    },
  }, async (request, reply) => {
    const { tenant_id, page = 1, per_page = 20, type, category, active, search } =
      request.query as Record<string, unknown>;

    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenant_id];
    let idx = 2;

    if (type)     { conditions.push(`type = $${idx++}`);     params.push(type); }
    if (category) { conditions.push(`category = $${idx++}`); params.push(category); }
    if (active !== undefined) { conditions.push(`is_active = $${idx++}`); params.push(active); }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR sku ILIKE $${idx} OR description ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (Number(page) - 1) * Number(per_page);

    const [{ rows: [{ count }] }, { rows: data }] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM materials ${where}`, params),
      pool.query(`SELECT * FROM materials ${where} ORDER BY name ASC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, per_page, offset]),
    ]);

    return reply.send({
      data,
      meta: { total: Number(count), page: Number(page), per_page: Number(per_page),
              pages: Math.ceil(Number(count) / Number(per_page)) },
    });
  });

  // GET /v1/materials/:id
  app.get('/materials/:id', {
    schema: { params: idParam, response: { 200: materialResponse } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM materials WHERE id = $1', [id]);
    if (!rows[0]) return reply.notFound('Material not found');
    return reply.send(rows[0]);
  });

  // PATCH /v1/materials/:id
  app.patch('/materials/:id', {
    schema: { params: idParam, body: materialBody, response: { 200: materialResponse } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as Record<string, unknown>;

    const allowed = ['sku','name','description','type','category','brand','unit',
                     'sale_price','cost_price','ncm_code','tax_group','weight_kg',
                     'is_active','tracks_inventory'];
    const updates = Object.entries(b).filter(([k]) => allowed.includes(k));
    if (!updates.length) return reply.badRequest('No valid fields to update');

    const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE materials SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...updates.map(([, v]) => v)],
    );
    if (!rows[0]) return reply.notFound('Material not found');
    return reply.send(rows[0]);
  });

  // DELETE /v1/materials/:id — soft deactivate
  app.delete('/materials/:id', {
    schema: { params: idParam, response: { 200: materialResponse } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `UPDATE materials SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`, [id],
    );
    if (!rows[0]) return reply.notFound('Material not found');
    return reply.send(rows[0]);
  });

  // ── Stock endpoints ─────────────────────────────────────────────────────────

  // GET /v1/materials/:id/stock — current inventory level
  app.get('/materials/:id/stock', {
    schema: {
      params: idParam,
      response: {
        200: {
          type: 'object',
          properties: {
            material_id:  { type: 'string' },
            quantity:     { type: 'number' },
            min_qty:      { type: 'number' },
            max_qty:      { type: ['number', 'null'] },
            is_low_stock: { type: 'boolean' },
            updated_at:   { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(`
      SELECT i.*, (i.quantity <= i.min_qty) AS is_low_stock
      FROM inventory i
      JOIN materials m ON m.id = i.material_id
      WHERE i.material_id = $1
    `, [id]);
    if (!rows[0]) return reply.notFound('Inventory record not found — material may not track stock');
    return reply.send(rows[0]);
  });

  // POST /v1/materials/:id/stock/movements — record a stock movement
  app.post('/materials/:id/stock/movements', {
    schema: {
      params: idParam,
      body: {
        type: 'object',
        required: ['movement_type', 'quantity'],
        properties: {
          movement_type:  { type: 'string', enum: ['in', 'out', 'adjustment', 'return', 'transfer'] },
          quantity:       { type: 'number', minimum: 0.001 },
          reason:         { type: 'string' },
          reference_id:   { type: 'string', format: 'uuid' },
          reference_type: { type: 'string', maxLength: 50 },
          created_by:     { type: 'string', format: 'uuid' },
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the inventory row to prevent concurrent race conditions
      const { rows: inv } = await client.query(
        'SELECT * FROM inventory WHERE material_id = $1 FOR UPDATE', [materialId],
      );
      if (!inv[0]) {
        await client.query('ROLLBACK');
        return reply.notFound('Inventory record not found — material may not track stock');
      }

      const quantityBefore = Number(inv[0].quantity);
      const quantityAfter  = quantityBefore + delta;

      if (b.movement_type === 'out' && quantityAfter < 0) {
        await client.query('ROLLBACK');
        return reply.badRequest(
          `Insufficient stock: available ${quantityBefore}, requested ${b.quantity}`
        );
      }

      await client.query(
        'UPDATE inventory SET quantity = $1, updated_at = NOW() WHERE material_id = $2',
        [quantityAfter, materialId],
      );

      const { rows: [movement] } = await client.query(`
        INSERT INTO inventory_movements
          (tenant_id, material_id, movement_type, quantity,
           quantity_before, quantity_after, reason,
           reference_id, reference_type, created_by)
        SELECT tenant_id, $1, $2, $3, $4, $5, $6, $7, $8, $9
        FROM inventory WHERE material_id = $1
        RETURNING *
      `, [materialId, b.movement_type, delta,
          quantityBefore, quantityAfter, b.reason ?? null,
          b.reference_id ?? null, b.reference_type ?? null, b.created_by ?? null]);

      await client.query('COMMIT');
      return reply.status(201).send(movement);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /v1/materials/:id/stock/movements — movement history
  app.get('/materials/:id/stock/movements', {
    schema: {
      params: idParam,
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          type:     { type: 'string', enum: ['in','out','adjustment','return','transfer'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = 1, per_page = 20, type } = request.query as Record<string, unknown>;

    const conditions = ['material_id = $1'];
    const params: unknown[] = [id];
    let idx = 2;
    if (type) { conditions.push(`movement_type = $${idx++}`); params.push(type); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const offset = (Number(page) - 1) * Number(per_page);

    const [{ rows: [{ count }] }, { rows: data }] = await Promise.all([
      pool.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM inventory_movements ${where}`, params),
      pool.query(`SELECT * FROM inventory_movements ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
        [...params, per_page, offset]),
    ]);

    return reply.send({
      data,
      meta: { total: Number(count), page: Number(page), per_page: Number(per_page),
              pages: Math.ceil(Number(count) / Number(per_page)) },
    });
  });

  // GET /v1/stock/alerts — materials below min_qty (low stock alert)
  app.get('/stock/alerts', {
    schema: {
      querystring: {
        type: 'object',
        required: ['tenant_id'],
        properties: { tenant_id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request, reply) => {
    const { tenant_id } = request.query as { tenant_id: string };
    const { rows } = await pool.query(`
      SELECT m.id, m.sku, m.name, m.unit, m.category,
             i.quantity, i.min_qty, i.max_qty,
             (i.min_qty - i.quantity) AS shortage
      FROM inventory i
      JOIN materials m ON m.id = i.material_id
      WHERE i.tenant_id = $1
        AND i.quantity <= i.min_qty
        AND m.is_active = true
      ORDER BY shortage DESC, m.name
    `, [tenant_id]);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });
};
