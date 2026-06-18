import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';

// ── Shared JSON Schema fragments ─────────────────────────────────────────────

const contactSchema = {
  type: 'object',
  properties: {
    name:  { type: 'string', maxLength: 255 },
    phone: { type: 'string', maxLength: 30 },
    email: { type: 'string', format: 'email', maxLength: 255 },
  },
} as const;

const customerBodySchema = {
  type: 'object',
  properties: {
    // Company identification
    company_name: { type: 'string', minLength: 1, maxLength: 255 },
    trade_name:   { type: 'string', maxLength: 255 },
    tax_id:       { type: 'string', minLength: 1, maxLength: 50 },
    tax_id_type:  { type: 'string', enum: ['CNPJ', 'EIN', 'VAT', 'OTHER'], default: 'CNPJ' },

    // Address
    street:        { type: 'string', maxLength: 255 },
    street_number: { type: 'string', maxLength: 20 },
    complement:    { type: 'string', maxLength: 100 },
    neighborhood:  { type: 'string', maxLength: 100 },
    city:          { type: 'string', maxLength: 100 },
    state:         { type: 'string', maxLength: 100 },
    postal_code:   { type: 'string', maxLength: 20 },
    country:       { type: 'string', minLength: 2, maxLength: 2, default: 'BR' },

    // Main contact
    phone:   { type: 'string', maxLength: 30 },
    website: { type: 'string', maxLength: 255 },

    // Purchasing contact
    purchasing_contact_name:  { type: 'string', maxLength: 255 },
    purchasing_contact_phone: { type: 'string', maxLength: 30 },
    purchasing_contact_email: { type: 'string', format: 'email', maxLength: 255 },

    // Maintenance contact
    maintenance_contact_name:  { type: 'string', maxLength: 255 },
    maintenance_contact_phone: { type: 'string', maxLength: 30 },
    maintenance_contact_email: { type: 'string', format: 'email', maxLength: 255 },

    // Fiscal / tax contact
    fiscal_contact_name:  { type: 'string', maxLength: 255 },
    fiscal_contact_phone: { type: 'string', maxLength: 30 },
    fiscal_contact_email: { type: 'string', format: 'email', maxLength: 255 },

    // SaaS plan
    plan:         { type: 'string', enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
    trial_ends_at: { type: 'string', format: 'date-time' },
  },
} as const;

const createSchema = {
  ...customerBodySchema,
  required: ['company_name', 'tax_id'],
} as const;

const patchSchema = customerBodySchema;

const customerResponse = {
  type: 'object',
  properties: {
    id:           { type: 'string', format: 'uuid' },
    company_name: { type: 'string' },
    trade_name:   { type: ['string', 'null'] },
    tax_id:       { type: 'string' },
    tax_id_type:  { type: 'string' },
    street:        { type: ['string', 'null'] },
    street_number: { type: ['string', 'null'] },
    complement:    { type: ['string', 'null'] },
    neighborhood:  { type: ['string', 'null'] },
    city:          { type: ['string', 'null'] },
    state:         { type: ['string', 'null'] },
    postal_code:   { type: ['string', 'null'] },
    country:       { type: 'string' },
    phone:         { type: ['string', 'null'] },
    website:       { type: ['string', 'null'] },
    purchasing_contact_name:  { type: ['string', 'null'] },
    purchasing_contact_phone: { type: ['string', 'null'] },
    purchasing_contact_email: { type: ['string', 'null'] },
    maintenance_contact_name:  { type: ['string', 'null'] },
    maintenance_contact_phone: { type: ['string', 'null'] },
    maintenance_contact_email: { type: ['string', 'null'] },
    fiscal_contact_name:  { type: ['string', 'null'] },
    fiscal_contact_phone: { type: ['string', 'null'] },
    fiscal_contact_email: { type: ['string', 'null'] },
    status:       { type: 'string' },
    plan:         { type: 'string' },
    trial_ends_at: { type: ['string', 'null'] },
    created_at:   { type: 'string' },
    updated_at:   { type: 'string' },
  },
} as const;

// ── Route Plugin ──────────────────────────────────────────────────────────────

export const customersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // POST /v1/customers — create
  app.post('/customers', {
    schema: {
      body: createSchema,
      response: { 201: customerResponse },
    },
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    const { rows } = await pool.query<Record<string, unknown>>(`
      INSERT INTO tenants (
        company_name, trade_name, tax_id, tax_id_type,
        street, street_number, complement, neighborhood, city, state, postal_code, country,
        phone, website,
        purchasing_contact_name, purchasing_contact_phone, purchasing_contact_email,
        maintenance_contact_name, maintenance_contact_phone, maintenance_contact_email,
        fiscal_contact_name, fiscal_contact_phone, fiscal_contact_email,
        plan, trial_ends_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14,
        $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23,
        $24, $25
      )
      RETURNING *
    `, [
      body.company_name, body.trade_name ?? null, body.tax_id, body.tax_id_type ?? 'CNPJ',
      body.street ?? null, body.street_number ?? null, body.complement ?? null,
      body.neighborhood ?? null, body.city ?? null, body.state ?? null,
      body.postal_code ?? null, body.country ?? 'BR',
      body.phone ?? null, body.website ?? null,
      body.purchasing_contact_name ?? null, body.purchasing_contact_phone ?? null, body.purchasing_contact_email ?? null,
      body.maintenance_contact_name ?? null, body.maintenance_contact_phone ?? null, body.maintenance_contact_email ?? null,
      body.fiscal_contact_name ?? null, body.fiscal_contact_phone ?? null, body.fiscal_contact_email ?? null,
      body.plan ?? 'starter', body.trial_ends_at ?? null,
    ]);

    return reply.status(201).send(rows[0]);
  });

  // GET /v1/customers — list (paginated)
  app.get('/customers', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status:   { type: 'string', enum: ['trial', 'active', 'suspended', 'cancelled'] },
          search:   { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data:  { type: 'array', items: customerResponse },
            meta: {
              type: 'object',
              properties: {
                total:    { type: 'integer' },
                page:     { type: 'integer' },
                per_page: { type: 'integer' },
                pages:    { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, search } = request.query as {
      page?: number; per_page?: number; status?: string; search?: string;
    };
    const offset = (page - 1) * per_page;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(company_name ILIKE $${idx} OR tax_id ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM tenants ${where}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    const { rows } = await pool.query(
      `SELECT * FROM tenants ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, per_page, offset],
    );

    return reply.send({
      data: rows,
      meta: { total, page, per_page, pages: Math.ceil(total / per_page) },
    });
  });

  // GET /v1/customers/:id — get one
  app.get('/customers/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: { 200: customerResponse },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (!rows[0]) return reply.notFound('Customer not found');
    return reply.send(rows[0]);
  });

  // PATCH /v1/customers/:id — update
  app.patch('/customers/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: patchSchema,
      response: { 200: customerResponse },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const allowed = [
      'company_name', 'trade_name', 'tax_id', 'tax_id_type',
      'street', 'street_number', 'complement', 'neighborhood',
      'city', 'state', 'postal_code', 'country',
      'phone', 'website',
      'purchasing_contact_name', 'purchasing_contact_phone', 'purchasing_contact_email',
      'maintenance_contact_name', 'maintenance_contact_phone', 'maintenance_contact_email',
      'fiscal_contact_name', 'fiscal_contact_phone', 'fiscal_contact_email',
      'plan', 'trial_ends_at',
    ];

    const updates = Object.entries(body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) return reply.badRequest('No valid fields to update');

    const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = [id, ...updates.map(([, v]) => v)];

    const { rows } = await pool.query(
      `UPDATE tenants SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values,
    );
    if (!rows[0]) return reply.notFound('Customer not found');
    return reply.send(rows[0]);
  });

  // DELETE /v1/customers/:id — soft delete (suspend)
  app.delete('/customers/:id', {
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: { 200: customerResponse },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rows } = await pool.query(
      `UPDATE tenants SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id],
    );
    if (!rows[0]) return reply.notFound('Customer not found');
    return reply.send(rows[0]);
  });
};
