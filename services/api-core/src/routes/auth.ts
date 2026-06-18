import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool';

const registerBody = {
  type: 'object',
  required: ['company_name', 'tax_id', 'email', 'password'],
  properties: {
    company_name:  { type: 'string', minLength: 2, maxLength: 255 },
    trade_name:    { type: 'string', maxLength: 255 },
    tax_id:        { type: 'string', minLength: 5, maxLength: 50 },
    tax_id_type:   { type: 'string', enum: ['CNPJ', 'EIN', 'VAT', 'OTHER'] },
    name:          { type: 'string', maxLength: 255 },
    email:         { type: 'string', format: 'email' },
    password:      { type: 'string', minLength: 8 },
  },
  additionalProperties: false,
};

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email:    { type: 'string', format: 'email' },
    password: { type: 'string' },
  },
  additionalProperties: false,
};

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/auth/register — creates tenant + owner user in one transaction
  fastify.post('/auth/register', { schema: { body: registerBody } }, async (request, reply) => {
    const {
      company_name,
      trade_name,
      tax_id,
      tax_id_type = 'CNPJ',
      name,
      email,
      password,
    } = request.body as any;

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: [tenant] } = await client.query(
        `INSERT INTO tenants (company_name, trade_name, tax_id, tax_id_type, status, plan)
         VALUES ($1, $2, $3, $4, 'trial', 'starter')
         RETURNING id`,
        [company_name, trade_name || company_name, tax_id, tax_id_type],
      );

      const displayName = name || email.split('@')[0];
      const { rows: [user] } = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role, status)
         VALUES ($1, $2, $3, $4, 'owner', 'active')
         RETURNING id, email, name, role`,
        [tenant.id, email, displayName, passwordHash],
      );

      await client.query('COMMIT');

      const token = fastify.jwt.sign(
        { tenantId: tenant.id, userId: user.id, role: user.role },
        { expiresIn: '24h' },
      );

      return reply.code(201).send({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        tenantId: tenant.id,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return reply.conflict('Email or tax ID already registered');
      }
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /v1/auth/login
  fastify.post('/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
    const { email, password } = request.body as any;

    const { rows } = await pool.query(
      `SELECT id, email, name, password_hash, role, status, tenant_id
       FROM users WHERE email = $1`,
      [email],
    );

    if (!rows.length) return reply.unauthorized('Invalid credentials');

    const user = rows[0];
    if (user.status !== 'active') return reply.unauthorized('Account disabled');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.unauthorized('Invalid credentials');

    const token = fastify.jwt.sign(
      { tenantId: user.tenant_id, userId: user.id, role: user.role },
      { expiresIn: '24h' },
    );

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenantId: user.tenant_id,
    };
  });

  // GET /v1/auth/me — returns current user (requires JWT)
  fastify.get('/auth/me', {
    preHandler: [(fastify as any).authenticate],
  }, async (request) => {
    const { userId } = (request as any).user;
    const { rows } = await pool.query(
      'SELECT id, email, name, role, tenant_id, status FROM users WHERE id = $1',
      [userId],
    );
    return rows[0] ?? null;
  });
};
