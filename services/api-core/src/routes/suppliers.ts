import { FastifyPluginAsync } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { db, suppliers, payables } from '../db';
import { normalizeCNPJ } from '../domain/cnpj/cnpjDomain';
import { requirePermission } from '../lib/requirePermission';

const VALID_CATEGORIES = ['services', 'supplies', 'utilities', 'rent', 'payroll', 'taxes', 'other'] as const;

export const suppliersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/suppliers ──────────────────────────────────────────────────── */
  fastify.get('/suppliers', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:view')] }, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, is_active, category, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    // Default: show only active; is_active=all → show all; is_active=false → only inactive
    const activeFilter = is_active === 'all'
      ? sql``
      : is_active === 'false'
        ? sql`AND is_active = false`
        : sql`AND is_active = true`;

    const categoryFilter = category && category !== 'all'
      ? sql`AND category = ${category}`
      : sql``;

    const searchFilter = search
      ? sql`AND (
          COALESCE(company_name,'') ILIKE ${'%' + search + '%'} OR
          COALESCE(trade_name,'') ILIKE ${'%' + search + '%'} OR
          COALESCE(full_name,'') ILIKE ${'%' + search + '%'} OR
          COALESCE(cnpj,'') ILIKE ${'%' + search + '%'} OR
          COALESCE(cpf,'') ILIKE ${'%' + search + '%'}
        )`
      : sql``;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT id, person_type, company_name, trade_name, cnpj, full_name, cpf,
               email, phone, city, state, category, is_active, created_at
        FROM suppliers
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${categoryFilter} ${searchFilter}
        ORDER BY COALESCE(company_name, full_name) ASC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM suppliers
        WHERE tenant_id = ${tenantId}
          ${activeFilter} ${categoryFilter} ${searchFilter}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  /* ── POST /v1/suppliers ─────────────────────────────────────────────────── */
  fastify.post('/suppliers', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:create')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const b = request.body as Record<string, any>;

    const person_type = b.person_type ?? 'PJ';
    if (!['PJ', 'PF'].includes(person_type))
      return reply.badRequest('person_type deve ser PJ ou PF');
    if (person_type === 'PJ' && !b.company_name)
      return reply.badRequest('company_name é obrigatório para PJ');
    if (person_type === 'PF' && !b.full_name)
      return reply.badRequest('full_name é obrigatório para PF');

    const category = b.category ?? 'services';
    if (!VALID_CATEGORIES.includes(category))
      return reply.badRequest(`category inválida. Valores aceitos: ${VALID_CATEGORIES.join(', ')}`);

    const [row] = await db.insert(suppliers).values({
      tenant_id:     tenantId,
      person_type,
      company_name:  b.company_name  || null,
      trade_name:    b.trade_name    || null,
      cnpj:          b.cnpj ? normalizeCNPJ(b.cnpj as string) : null,
      full_name:     b.full_name     || null,
      cpf:           b.cpf           || null,
      email:         b.email         || null,
      phone:         b.phone         || null,
      zip_code:      b.zip_code      || null,
      street:        b.street        || null,
      street_number: b.street_number || null,
      complement:    b.complement    || null,
      neighborhood:  b.neighborhood  || null,
      city:          b.city          || null,
      state:         b.state         || null,
      bank_code:     b.bank_code     || null,
      agency:        b.agency        || null,
      account:       b.account       || null,
      account_digit: b.account_digit || null,
      pix_key:       b.pix_key       || null,
      category,
      notes:         b.notes         || null,
      is_active:     b.is_active !== undefined ? Boolean(b.is_active) : true,
    }).returning();

    return reply.code(201).send(row);
  });

  /* ── GET /v1/suppliers/:id ──────────────────────────────────────────────── */
  fastify.get('/suppliers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [sup] = await db.select().from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));

    if (!sup) return reply.notFound('Fornecedor não encontrado');

    // Mask pix_key: show only last 4 chars
    const pix_key_masked = sup.pix_key
      ? '****' + sup.pix_key.slice(-4)
      : null;

    return { ...sup, pix_key: pix_key_masked };
  });

  /* ── PATCH /v1/suppliers/:id ────────────────────────────────────────────── */
  fastify.patch('/suppliers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:edit')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const b        = request.body as Record<string, any>;

    const [existing] = await db.select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Fornecedor não encontrado');

    if (b.person_type !== undefined && !['PJ', 'PF'].includes(b.person_type))
      return reply.badRequest('person_type deve ser PJ ou PF');
    if (b.category !== undefined && !VALID_CATEGORIES.includes(b.category))
      return reply.badRequest(`category inválida. Valores aceitos: ${VALID_CATEGORIES.join(', ')}`);

    const patch: Record<string, unknown> = {};
    const fields = [
      'person_type','company_name','trade_name','cnpj','full_name','cpf',
      'email','phone','zip_code','street','street_number','complement',
      'neighborhood','city','state','bank_code','agency','account',
      'account_digit','pix_key','category','notes','is_active',
    ];
    for (const f of fields) {
      if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
    }
    // is_active must stay boolean
    if (b.is_active !== undefined) patch.is_active = Boolean(b.is_active);

    if (Object.keys(patch).length === 0) return reply.badRequest('Nenhum campo para atualizar');

    await db.update(suppliers).set(patch as any)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));

    return { ok: true };
  });

  /* ── DELETE /v1/suppliers/:id (soft delete) ─────────────────────────────── */
  fastify.delete('/suppliers/:id', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:delete')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [existing] = await db.select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Fornecedor não encontrado');

    await db.update(suppliers).set({ is_active: false })
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));

    return { ok: true, is_active: false };
  });

  /* ── GET /v1/suppliers/:id/payables ─────────────────────────────────────── */
  fastify.get('/suppliers/:id/payables', { onRequest: [(fastify as any).authenticate], preHandler: [requirePermission('suppliers:view')] }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };
    const { page = '1', per_page = '10' } = request.query as Record<string, string>;

    const [existing] = await db.select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Fornecedor não encontrado');

    const limit  = Math.min(Number(per_page) || 10, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.execute<any>(sql`
        SELECT id, description, supplier_name, category, document_number,
               amount, paid_amount, due_date, status, created_at
        FROM payables
        WHERE supplier_id = ${id} AND tenant_id = ${tenantId}
        ORDER BY due_date DESC, created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute<{ count: string }>(sql`
        SELECT COUNT(*) AS count FROM payables
        WHERE supplier_id = ${id} AND tenant_id = ${tenantId}
      `),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });
};
