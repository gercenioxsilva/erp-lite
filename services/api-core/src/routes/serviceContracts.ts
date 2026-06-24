import { FastifyPluginAsync } from 'fastify';
import { eq, and, ilike, or, sql } from 'drizzle-orm';
import { db, serviceContracts, contractBillings, receivables, clients, materials } from '../db';

const FREQUENCIES = ['monthly', 'quarterly', 'semiannual', 'annual'] as const;
const STATUSES    = ['active', 'paused', 'cancelled', 'expired'] as const;

const contractBody = {
  type: 'object',
  properties: {
    tenant_id:         { type: 'string', format: 'uuid' },
    client_id:         { type: 'string', format: 'uuid' },
    material_id:       { type: 'string', format: 'uuid' },
    description:       { type: 'string', minLength: 1 },
    start_date:        { type: 'string', format: 'date' },
    end_date:          { type: 'string', format: 'date' },
    billing_frequency: { type: 'string', enum: FREQUENCIES },
    billing_day:       { type: 'integer', minimum: 1, maximum: 28 },
    amount:            { type: 'number', minimum: 0.01 },
    status:            { type: 'string', enum: STATUSES },
    notes:             { type: 'string' },
  },
  additionalProperties: false,
};

const patchBody = { ...contractBody, required: [] as string[] };

export const serviceContractsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /v1/service-contracts
  fastify.get('/service-contracts', async (request, reply) => {
    const {
      tenant_id, client_id, status, search,
      page = '1', per_page = '20',
    } = request.query as Record<string, string>;

    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: any[] = [eq(serviceContracts.tenant_id, tenant_id)];
    if (client_id) conditions.push(eq(serviceContracts.client_id, client_id));
    if (status)    conditions.push(eq(serviceContracts.status, status));
    if (search) conditions.push(or(
      ilike(serviceContracts.description,     `%${search}%`),
      ilike(serviceContracts.contract_number, `%${search}%`),
    ));
    const where = and(...conditions as [any, ...any[]]);

    const [[{ total }], rows] = await Promise.all([
      db.select({ total: sql<number>`COUNT(*)::int` }).from(serviceContracts).where(where),
      db.execute<any>(sql`
        SELECT sc.*,
               COALESCE(c.company_name, c.full_name) AS client_name,
               m.name AS material_name
        FROM service_contracts sc
        JOIN clients  c ON c.id = sc.client_id
        LEFT JOIN materials m ON m.id = sc.material_id
        WHERE sc.tenant_id = ${tenant_id}
          ${client_id ? sql`AND sc.client_id = ${client_id}::uuid` : sql``}
          ${status    ? sql`AND sc.status = ${status}`             : sql``}
          ${search    ? sql`AND (sc.description ILIKE ${'%' + search + '%'} OR sc.contract_number ILIKE ${'%' + search + '%'})` : sql``}
        ORDER BY sc.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);

    return { data: rows.rows, total, page: Number(page), per_page: limit };
  });

  // POST /v1/service-contracts
  fastify.post('/service-contracts', {
    schema: {
      body: {
        ...contractBody,
        required: ['tenant_id', 'client_id', 'description', 'start_date', 'billing_frequency', 'billing_day', 'amount'],
      },
    },
  }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;

    // Verify client belongs to tenant
    const [c] = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.id, b.client_id as string), eq(clients.tenant_id, b.tenant_id as string)));
    if (!c) return reply.notFound('Client not found');

    // Generate sequential contract number
    const { rows: [seq] } = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM service_contracts WHERE tenant_id = ${b.tenant_id as string}
    `);
    const contractNumber = String(seq.count + 1).padStart(5, '0');

    const [contract] = await db.insert(serviceContracts).values({
      tenant_id:         b.tenant_id         as string,
      client_id:         b.client_id         as string,
      material_id:       (b.material_id      ?? null) as string | null,
      contract_number:   contractNumber,
      description:       b.description       as string,
      start_date:        b.start_date        as string,
      end_date:          (b.end_date         ?? null) as string | null,
      billing_frequency: (b.billing_frequency ?? 'monthly') as string,
      billing_day:       Number(b.billing_day ?? 1),
      amount:            String(b.amount),
      status:            'active',
      notes:             (b.notes            ?? null) as string | null,
      created_by:        (b.created_by       ?? null) as string | null,
    }).returning();

    return reply.code(201).send(contract);
  });

  // GET /v1/service-contracts/:id
  fastify.get<{ Params: { id: string } }>('/service-contracts/:id', async (request, reply) => {
    const { id } = request.params;
    const { rows } = await db.execute<any>(sql`
      SELECT sc.*,
             COALESCE(c.company_name, c.full_name) AS client_name,
             m.name AS material_name
      FROM service_contracts sc
      JOIN clients  c ON c.id = sc.client_id
      LEFT JOIN materials m ON m.id = sc.material_id
      WHERE sc.id = ${id}
    `);
    if (!rows[0]) return reply.notFound('Contract not found');

    const billings = await db.execute<any>(sql`
      SELECT cb.*,
             r.status AS receivable_status,
             r.paid_amount,
             r.due_date AS receivable_due_date
      FROM contract_billings cb
      LEFT JOIN receivables r ON r.id = cb.receivable_id
      WHERE cb.contract_id = ${id}
      ORDER BY cb.period_start DESC
    `);

    return { ...rows[0], billings: billings.rows };
  });

  // PATCH /v1/service-contracts/:id
  fastify.patch<{ Params: { id: string } }>('/service-contracts/:id', {
    schema: { body: patchBody },
  }, async (request, reply) => {
    const { id } = request.params;
    const b = request.body as Record<string, unknown>;

    const [existing] = await db.select({ id: serviceContracts.id })
      .from(serviceContracts).where(eq(serviceContracts.id, id));
    if (!existing) return reply.notFound('Contract not found');

    const allowed = ['description', 'client_id', 'material_id', 'start_date', 'end_date',
                     'billing_frequency', 'billing_day', 'amount', 'status', 'notes'];
    const updateData = Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(updateData).length) return reply.badRequest('No fields to update');

    const [updated] = await db.update(serviceContracts)
      .set(updateData as any)
      .where(eq(serviceContracts.id, id))
      .returning();

    return updated;
  });

  // POST /v1/service-contracts/:id/billings — gera cobrança manualmente para o período atual
  fastify.post<{ Params: { id: string } }>('/service-contracts/:id/billings', async (request, reply) => {
    const { id: contractId } = request.params;

    const { rows } = await db.execute<any>(sql`
      SELECT sc.*, COALESCE(c.company_name, c.full_name) AS client_name
      FROM service_contracts sc
      JOIN clients c ON c.id = sc.client_id
      WHERE sc.id = ${contractId}
    `);
    const contract = rows[0];
    if (!contract) return reply.notFound('Contract not found');
    if (contract.status !== 'active') return reply.badRequest('Contract is not active');

    const today = new Date();
    const year  = today.getFullYear();
    const month = today.getMonth() + 1;
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay     = new Date(year, month, 0).getDate();
    const periodEnd   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const dueDate     = today.toISOString().slice(0, 10);

    // Check if billing already exists for this period
    const { rows: [exists] } = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM contract_billings
      WHERE contract_id = ${contractId}
        AND period_start = ${periodStart}
        AND status != 'cancelled'
    `);
    if (exists.count > 0) return reply.conflict('Billing already generated for current period');

    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const description = `${contract.description} — ${months[month - 1]}/${year}`;

    let billing: any;
    await db.transaction(async (tx) => {
      const [rec] = await tx.insert(receivables).values({
        tenant_id:   contract.tenant_id,
        client_id:   contract.client_id,
        description,
        amount:      contract.amount,
        due_date:    dueDate,
        status:      'pending',
        notes:       'Gerado pelo contrato de manutenção',
      }).returning();

      const [b] = await tx.insert(contractBillings).values({
        tenant_id:     contract.tenant_id,
        contract_id:   contractId,
        receivable_id: rec.id,
        period_start:  periodStart,
        period_end:    periodEnd,
        amount:        contract.amount,
        due_date:      dueDate,
        status:        'billed',
      }).returning();
      billing = { ...b, receivable_id: rec.id };
    });

    return reply.code(201).send(billing);
  });

  // GET /v1/service-contracts/:id/billings
  fastify.get<{ Params: { id: string } }>('/service-contracts/:id/billings', async (request, reply) => {
    const { id: contractId } = request.params;

    const { rows } = await db.execute<any>(sql`
      SELECT cb.*,
             r.status AS receivable_status,
             r.paid_amount,
             r.amount AS receivable_amount
      FROM contract_billings cb
      LEFT JOIN receivables r ON r.id = cb.receivable_id
      WHERE cb.contract_id = ${contractId}
      ORDER BY cb.period_start DESC
    `);

    return { data: rows };
  });
};
