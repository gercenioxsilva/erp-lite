import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db, tenants, users } from '../db';

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
      password,
    } = request.body as any;

    const email        = ((request.body as any).email as string).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name || email.split('@')[0];

    try {
      const result = await db.transaction(async (tx) => {
        const [tenant] = await tx.insert(tenants).values({
          company_name,
          trade_name: trade_name || company_name,
          tax_id,
          tax_id_type,
          status: 'trial',
          plan:   'starter',
        }).returning({ id: tenants.id });

        const [user] = await tx.insert(users).values({
          tenant_id:     tenant.id,
          email,
          name:          displayName,
          password_hash: passwordHash,
          role:   'owner',
          status: 'active',
        }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });

        return { tenant, user };
      });

      const token = fastify.jwt.sign(
        { tenantId: result.tenant.id, userId: result.user.id, role: result.user.role },
        { expiresIn: '24h' },
      );

      return reply.code(201).send({
        token,
        user:     { id: result.user.id, email: result.user.email, name: result.user.name, role: result.user.role },
        tenantId: result.tenant.id,
      });
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('Email or tax ID already registered');
      throw err;
    }
  });

  // POST /v1/auth/login
  fastify.post('/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
    const { password } = request.body as any;
    const email = ((request.body as any).email as string).toLowerCase().trim();

    const rows = await db.select().from(users).where(sql`LOWER(TRIM(${users.email})) = ${email}`);

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
      user:     { id: user.id, email: user.email, name: user.name, role: user.role },
      tenantId: user.tenant_id,
    };
  });

  // GET /v1/auth/me
  fastify.get('/auth/me', {
    preHandler: [(fastify as any).authenticate],
  }, async (request) => {
    const { userId } = (request as any).user;
    const [user] = await db.select({
      id: users.id, email: users.email, name: users.name,
      role: users.role, tenant_id: users.tenant_id, status: users.status,
    }).from(users).where(eq(users.id, userId));
    return user ?? null;
  });
};
