import { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool';

const clientBody = {
  type: 'object',
  required: ['tenant_id', 'person_type'],
  properties: {
    tenant_id:     { type: 'string', format: 'uuid' },
    person_type:   { type: 'string', enum: ['PJ', 'PF'] },
    // PJ
    company_name:  { type: 'string', maxLength: 255 },
    trade_name:    { type: 'string', maxLength: 255 },
    cnpj:          { type: 'string', maxLength: 14 },
    state_reg:     { type: 'string', maxLength: 30 },
    municipal_reg: { type: 'string', maxLength: 30 },
    suframa:       { type: 'string', maxLength: 20 },
    // PF
    full_name:     { type: 'string', maxLength: 255 },
    cpf:           { type: 'string', maxLength: 11 },
    birth_date:    { type: 'string', format: 'date' },
    rg:            { type: 'string', maxLength: 20 },
    rg_issuer:     { type: 'string', maxLength: 30 },
    rg_issue_date: { type: 'string', format: 'date' },
    // Contact
    email:         { type: 'string', format: 'email' },
    phone:         { type: 'string', maxLength: 20 },
    mobile:        { type: 'string', maxLength: 20 },
    // Address
    zip_code:      { type: 'string', maxLength: 8 },
    street:        { type: 'string', maxLength: 255 },
    street_number: { type: 'string', maxLength: 20 },
    complement:    { type: 'string', maxLength: 100 },
    neighborhood:  { type: 'string', maxLength: 100 },
    city:          { type: 'string', maxLength: 100 },
    state:         { type: 'string', maxLength: 2 },
    country:       { type: 'string', maxLength: 2 },
    // NF-e
    icms_taxpayer: { type: 'string', enum: ['1', '2', '9'] },
    consumer_type: { type: 'string', enum: ['0', '1'] },
    // Misc
    is_active:     { type: 'boolean' },
    notes:         { type: 'string' },
  },
  additionalProperties: false,
};

const patchBody = { ...clientBody, required: [] as string[] };

export const clientsRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /v1/clients
  fastify.post('/clients', { schema: { body: clientBody } }, async (request, reply) => {
    const b = request.body as Record<string, unknown>;

    if (b.person_type === 'PJ' && !b.company_name)
      return reply.badRequest('company_name is required for PJ');
    if (b.person_type === 'PF' && !b.full_name)
      return reply.badRequest('full_name is required for PF');

    // PF is always consumidor final
    const consumerType = b.person_type === 'PF' ? '1' : (b.consumer_type ?? '0');
    const icmsTaxpayer = b.person_type === 'PF' ? '9' : (b.icms_taxpayer ?? '9');

    const { rows: [client] } = await pool.query(
      `INSERT INTO clients (
         tenant_id, person_type,
         company_name, trade_name, cnpj, state_reg, municipal_reg, suframa,
         full_name, cpf, birth_date, rg, rg_issuer, rg_issue_date,
         email, phone, mobile,
         zip_code, street, street_number, complement, neighborhood, city, state, country,
         icms_taxpayer, consumer_type, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
       ) RETURNING *`,
      [
        b.tenant_id, b.person_type,
        b.company_name ?? null, b.trade_name ?? null, b.cnpj ?? null,
        b.state_reg ?? null, b.municipal_reg ?? null, b.suframa ?? null,
        b.full_name ?? null, b.cpf ?? null, b.birth_date ?? null,
        b.rg ?? null, b.rg_issuer ?? null, b.rg_issue_date ?? null,
        b.email ?? null, b.phone ?? null, b.mobile ?? null,
        b.zip_code ?? null, b.street ?? null, b.street_number ?? null,
        b.complement ?? null, b.neighborhood ?? null, b.city ?? null,
        b.state ?? null, b.country ?? 'BR',
        icmsTaxpayer, consumerType, b.notes ?? null,
      ],
    );
    return reply.code(201).send(client);
  });

  // GET /v1/clients
  fastify.get('/clients', async (request, reply) => {
    const q = request.query as Record<string, string>;
    const { tenant_id, person_type, search, page = '1', per_page = '20' } = q;

    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const conditions: string[] = ['tenant_id = $1', 'is_active = true'];
    const params: unknown[]    = [tenant_id];
    let   idx = 2;

    if (person_type) { conditions.push(`person_type = $${idx++}`); params.push(person_type); }

    if (search) {
      const term = `%${search}%`;
      conditions.push(`(company_name ILIKE $${idx} OR full_name ILIKE $${idx} OR cnpj = $${idx + 1} OR cpf = $${idx + 1})`);
      params.push(term, search);
      idx += 2;
    }

    const where = conditions.join(' AND ');

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      pool.query(
        `SELECT * FROM clients WHERE ${where} ORDER BY COALESCE(company_name, full_name) LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset],
      ),
      pool.query(`SELECT COUNT(*) FROM clients WHERE ${where}`, params),
    ]);

    return { data: rows, total: Number(cnt.count), page: Number(page), per_page: limit };
  });

  // GET /v1/clients/:id
  fastify.get<{ Params: { id: string } }>('/clients/:id', async (request, reply) => {
    const { rows: [c] } = await pool.query('SELECT * FROM clients WHERE id = $1', [request.params.id]);
    if (!c) return reply.notFound('Client not found');
    return c;
  });

  // PATCH /v1/clients/:id
  fastify.patch<{ Params: { id: string } }>('/clients/:id', { schema: { body: patchBody } }, async (request, reply) => {
    const { rows: [existing] } = await pool.query('SELECT id FROM clients WHERE id = $1', [request.params.id]);
    if (!existing) return reply.notFound('Client not found');

    const b = request.body as Record<string, unknown>;
    const allowed = [
      'person_type','company_name','trade_name','cnpj','state_reg','municipal_reg','suframa',
      'full_name','cpf','birth_date','rg','rg_issuer','rg_issue_date',
      'email','phone','mobile',
      'zip_code','street','street_number','complement','neighborhood','city','state','country',
      'icms_taxpayer','consumer_type','is_active','notes',
    ];

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    for (const key of allowed) {
      if (key in b) { sets.push(`${key} = $${i++}`); vals.push(b[key]); }
    }

    if (!sets.length) return reply.badRequest('No fields to update');

    vals.push(request.params.id);
    const { rows: [updated] } = await pool.query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals,
    );
    return updated;
  });

  // DELETE /v1/clients/:id (soft delete)
  fastify.delete<{ Params: { id: string } }>('/clients/:id', async (request, reply) => {
    const { rowCount } = await pool.query(
      'UPDATE clients SET is_active = false WHERE id = $1 AND is_active = true',
      [request.params.id],
    );
    if (!rowCount) return reply.notFound('Client not found or already inactive');
    return reply.code(204).send();
  });
};
