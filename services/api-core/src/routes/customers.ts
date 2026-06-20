import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db, tenants } from '../db';

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
    company_name: { type: 'string', minLength: 1, maxLength: 255 },
    trade_name:   { type: 'string', maxLength: 255 },
    tax_id:       { type: 'string', minLength: 1, maxLength: 50 },
    tax_id_type:  { type: 'string', enum: ['CNPJ', 'EIN', 'VAT', 'OTHER'], default: 'CNPJ' },
    street:        { type: 'string', maxLength: 255 },
    street_number: { type: 'string', maxLength: 20 },
    complement:    { type: 'string', maxLength: 100 },
    neighborhood:  { type: 'string', maxLength: 100 },
    city:          { type: 'string', maxLength: 100 },
    state:         { type: 'string', maxLength: 100 },
    postal_code:   { type: 'string', maxLength: 20 },
    country:       { type: 'string', minLength: 2, maxLength: 2, default: 'BR' },
    phone:   { type: 'string', maxLength: 30 },
    website: { type: 'string', maxLength: 255 },
    purchasing_contact_name:  { type: 'string', maxLength: 255 },
    purchasing_contact_phone: { type: 'string', maxLength: 30 },
    purchasing_contact_email: { type: 'string', format: 'email', maxLength: 255 },
    maintenance_contact_name:  { type: 'string', maxLength: 255 },
    maintenance_contact_phone: { type: 'string', maxLength: 30 },
    maintenance_contact_email: { type: 'string', format: 'email', maxLength: 255 },
    fiscal_contact_name:  { type: 'string', maxLength: 255 },
    fiscal_contact_phone: { type: 'string', maxLength: 30 },
    fiscal_contact_email: { type: 'string', format: 'email', maxLength: 255 },
    plan:          { type: 'string', enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
    trial_ends_at: { type: 'string', format: 'date-time' },
  },
} as const;

const createSchema   = { ...customerBodySchema, required: ['company_name', 'tax_id'] as const };
const patchSchema    = customerBodySchema;

const customerResponse = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' }, company_name: { type: 'string' },
    trade_name: { type: ['string', 'null'] }, tax_id: { type: 'string' },
    tax_id_type: { type: 'string' }, street: { type: ['string', 'null'] },
    street_number: { type: ['string', 'null'] }, complement: { type: ['string', 'null'] },
    neighborhood: { type: ['string', 'null'] }, city: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] }, postal_code: { type: ['string', 'null'] },
    country: { type: 'string' }, phone: { type: ['string', 'null'] },
    website: { type: ['string', 'null'] },
    purchasing_contact_name: { type: ['string', 'null'] },
    purchasing_contact_phone: { type: ['string', 'null'] },
    purchasing_contact_email: { type: ['string', 'null'] },
    maintenance_contact_name: { type: ['string', 'null'] },
    maintenance_contact_phone: { type: ['string', 'null'] },
    maintenance_contact_email: { type: ['string', 'null'] },
    fiscal_contact_name: { type: ['string', 'null'] },
    fiscal_contact_phone: { type: ['string', 'null'] },
    fiscal_contact_email: { type: ['string', 'null'] },
    status: { type: 'string' }, plan: { type: 'string' },
    trial_ends_at: { type: ['string', 'null'] },
    created_at: { type: 'string' }, updated_at: { type: 'string' },
  },
} as const;

export const customersRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {

  // POST /v1/customers
  app.post('/customers', {
    schema: { body: createSchema, response: { 201: customerResponse } },
  }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;
    const [row] = await db.insert(tenants).values({
      company_name: b.company_name as string,
      trade_name:   (b.trade_name ?? null) as string | null,
      tax_id:       b.tax_id as string,
      tax_id_type:  (b.tax_id_type ?? 'CNPJ') as string,
      street: (b.street ?? null) as string | null, street_number: (b.street_number ?? null) as string | null,
      complement: (b.complement ?? null) as string | null, neighborhood: (b.neighborhood ?? null) as string | null,
      city: (b.city ?? null) as string | null, state: (b.state ?? null) as string | null,
      postal_code: (b.postal_code ?? null) as string | null, country: (b.country ?? 'BR') as string,
      phone: (b.phone ?? null) as string | null, website: (b.website ?? null) as string | null,
      purchasing_contact_name:  (b.purchasing_contact_name  ?? null) as string | null,
      purchasing_contact_phone: (b.purchasing_contact_phone ?? null) as string | null,
      purchasing_contact_email: (b.purchasing_contact_email ?? null) as string | null,
      maintenance_contact_name:  (b.maintenance_contact_name  ?? null) as string | null,
      maintenance_contact_phone: (b.maintenance_contact_phone ?? null) as string | null,
      maintenance_contact_email: (b.maintenance_contact_email ?? null) as string | null,
      fiscal_contact_name:  (b.fiscal_contact_name  ?? null) as string | null,
      fiscal_contact_phone: (b.fiscal_contact_phone ?? null) as string | null,
      fiscal_contact_email: (b.fiscal_contact_email ?? null) as string | null,
      plan: (b.plan ?? 'starter') as string,
      trial_ends_at: (b.trial_ends_at ? new Date(b.trial_ends_at as string) : null) as Date | null,
    }).returning();
    return reply.status(201).send(row);
  });

  // GET /v1/customers
  app.get('/customers', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['trial', 'active', 'suspended', 'cancelled'] },
          search: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, search } = request.query as Record<string, unknown>;
    const offset = (Number(page) - 1) * Number(per_page);

    const conditions = [];
    if (status) conditions.push(eq(tenants.status, status as string));
    if (search) conditions.push(or(
      ilike(tenants.company_name, `%${search}%`),
      ilike(tenants.tax_id,       `%${search}%`),
    ));
    const where = conditions.length ? and(...conditions as [any, ...any[]]) : undefined;

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)::int` }).from(tenants).where(where),
      db.select().from(tenants).where(where)
        .orderBy(sql`${tenants.created_at} DESC`)
        .limit(Number(per_page)).offset(offset),
    ]);

    return reply.send({
      data: rows,
      meta: { total, page: Number(page), per_page: Number(per_page), pages: Math.ceil(total / Number(per_page)) },
    });
  });

  // GET /v1/customers/:id
  app.get('/customers/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!row) return reply.notFound('Customer not found');
    return reply.send(row);
  });

  // PATCH /v1/customers/:id
  app.patch('/customers/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: patchSchema,
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const allowed = [
      'company_name', 'trade_name', 'tax_id', 'tax_id_type',
      'street', 'street_number', 'complement', 'neighborhood',
      'city', 'state', 'postal_code', 'country', 'phone', 'website',
      'purchasing_contact_name', 'purchasing_contact_phone', 'purchasing_contact_email',
      'maintenance_contact_name', 'maintenance_contact_phone', 'maintenance_contact_email',
      'fiscal_contact_name', 'fiscal_contact_phone', 'fiscal_contact_email',
      'plan', 'trial_ends_at',
    ];
    const updateData = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updateData).length) return reply.badRequest('No valid fields to update');

    const [row] = await db.update(tenants)
      .set({ ...updateData as any, updated_at: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    if (!row) return reply.notFound('Customer not found');
    return reply.send(row);
  });

  // DELETE /v1/customers/:id (soft delete)
  app.delete('/customers/:id', {
    schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.update(tenants)
      .set({ status: 'cancelled', updated_at: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    if (!row) return reply.notFound('Customer not found');
    return reply.send(row);
  });
};
