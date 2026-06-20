import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db, users } from '../db';

export const usersRoutes: FastifyPluginAsync = async (fastify) => {

  /* ── GET /v1/users ──────────────────────────────────────────────────── */
  fastify.get('/users', async (request, reply) => {
    const { tenant_id, search, page = '1', per_page = '20' } =
      request.query as Record<string, string>;
    if (!tenant_id) return reply.badRequest('tenant_id is required');

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const baseWhere = eq(users.tenant_id, tenant_id);
    const where = search
      ? and(baseWhere, or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)))
      : baseWhere;

    const [rows, [cnt]] = await Promise.all([
      db.select({ id: users.id, email: users.email, name: users.name, role: users.role,
                  status: users.status, created_at: users.created_at })
        .from(users).where(where)
        .orderBy(sql`${users.name} ASC`)
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(users).where(where),
    ]);

    return { data: rows, total: cnt.count, page: Number(page), per_page: limit };
  });

  /* ── POST /v1/users ─────────────────────────────────────────────────── */
  fastify.post('/users', {
    schema: {
      body: {
        type: 'object',
        required: ['tenant_id', 'email', 'password', 'role'],
        properties: {
          tenant_id: { type: 'string', format: 'uuid' },
          email:     { type: 'string', format: 'email' },
          name:      { type: 'string', maxLength: 255 },
          password:  { type: 'string', minLength: 8 },
          role:      { type: 'string', enum: ['owner', 'admin', 'manager', 'user'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenant_id, email, name, password, role } = request.body as {
      tenant_id: string; email: string; name?: string; password: string; role: string;
    };

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name?.trim() || email.split('@')[0];

    try {
      const [user] = await db.insert(users).values({
        tenant_id, email, name: displayName, password_hash: passwordHash, role, status: 'active',
      }).returning({ id: users.id, email: users.email, name: users.name, role: users.role,
                    status: users.status, created_at: users.created_at });
      return reply.code(201).send(user);
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('E-mail já cadastrado neste tenant');
      throw err;
    }
  });

  /* ── PATCH /v1/users/:id ────────────────────────────────────────────── */
  fastify.patch('/users/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:     { type: 'string', maxLength: 255 },
          role:     { type: 'string', enum: ['owner', 'admin', 'manager', 'user'] },
          status:   { type: 'string', enum: ['active', 'disabled'] },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = request.body as { name?: string; role?: string; status?: string; password?: string };

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!existing) return reply.notFound('Usuário não encontrado');

    const updateData: Record<string, unknown> = {};
    if (b.name     !== undefined) updateData.name   = b.name;
    if (b.role     !== undefined) updateData.role   = b.role;
    if (b.status   !== undefined) updateData.status = b.status;
    if (b.password !== undefined) updateData.password_hash = await bcrypt.hash(b.password, 12);

    if (!Object.keys(updateData).length) return reply.badRequest('Nenhum campo para atualizar');

    const [updated] = await db.update(users)
      .set(updateData as any)
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status });
    return updated;
  });

  /* ── DELETE /v1/users/:id (soft-delete) ────────────────────────────── */
  fastify.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await db.update(users)
      .set({ status: 'disabled' })
      .where(and(eq(users.id, id), eq(users.status, 'active')));

    if (!result.rowCount) return reply.notFound('Usuário não encontrado ou já desabilitado');
    return reply.code(204).send();
  });
};
