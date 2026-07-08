import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, ilike, or, and, isNull, sql } from 'drizzle-orm';
import { db, users, roles } from '../db';
import { requirePermission } from '../lib/requirePermission';
import { sendSystemNotification } from '../lib/notificationsClient';

// Papel atribuível = existe como papel de sistema ou papel custom deste tenant.
async function isAssignableRole(tenantId: string, role: string): Promise<boolean> {
  const rows = await db.select({ id: roles.id }).from(roles)
    .where(and(eq(roles.key, role), or(eq(roles.tenant_id, tenantId), isNull(roles.tenant_id))));
  return rows.length > 0;
}

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;

  /* ── GET /v1/users ──────────────────────────────────────────────────── */
  fastify.get('/users', {
    onRequest: [authenticate], preHandler: [requirePermission('users:view')],
  }, async (request) => {
    const { tenantId } = (request as any).user;
    const { search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const baseWhere = eq(users.tenant_id, tenantId);
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
    onRequest: [authenticate], preHandler: [requirePermission('users:create')],
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'role'],
        properties: {
          // tenant_id ainda aceito por compat, mas IGNORADO — o tenant vem do JWT.
          tenant_id: { type: 'string', format: 'uuid' },
          email:     { type: 'string', format: 'email' },
          name:      { type: 'string', maxLength: 255 },
          password:  { type: 'string', minLength: 8 },
          role:      { type: 'string', minLength: 2, maxLength: 40 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const actor = (request as any).user;
    const tenantId = actor.tenantId;
    const { email, name, password, role } = request.body as {
      email: string; name?: string; password: string; role: string;
    };

    if (!(await isAssignableRole(tenantId, role))) return reply.badRequest('Papel inválido');
    if (role === 'owner' && actor.role !== 'owner') {
      return reply.forbidden('Apenas o proprietário pode atribuir o papel de proprietário.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name?.trim() || email.split('@')[0];

    try {
      const [user] = await db.insert(users).values({
        tenant_id: tenantId, email, name: displayName, password_hash: passwordHash, role, status: 'active',
      }).returning({ id: users.id, email: users.email, name: users.name, role: users.role,
                    status: users.status, created_at: users.created_at });

      sendSystemNotification({
        tenant_id: tenantId,
        type:      'user_welcome',
        recipient: { email, name: displayName },
        data: {
          name:      displayName,
          email,
          password,
          login_url: process.env.APP_URL ?? 'https://orquestraerp.com.br',
        },
      }).catch(() => { /* falha de e-mail não pode derrubar a criação */ });

      return reply.code(201).send(user);
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('E-mail já cadastrado neste tenant');
      throw err;
    }
  });

  /* ── PATCH /v1/users/:id ────────────────────────────────────────────── */
  fastify.patch('/users/:id', {
    onRequest: [authenticate], preHandler: [requirePermission('users:edit')],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:     { type: 'string', maxLength: 255 },
          role:     { type: 'string', minLength: 2, maxLength: 40 },
          status:   { type: 'string', enum: ['active', 'disabled'] },
          password: { type: 'string', minLength: 8 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const actor = (request as any).user;
    const tenantId = actor.tenantId;
    const { id } = request.params as { id: string };
    const b = request.body as { name?: string; role?: string; status?: string; password?: string };

    // Escopo por tenant — corrige o antigo lookup global por id.
    const [existing] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.id, id), eq(users.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Usuário não encontrado');

    if (b.role !== undefined) {
      if (!(await isAssignableRole(tenantId, b.role))) return reply.badRequest('Papel inválido');
      if (b.role === 'owner' && actor.role !== 'owner') {
        return reply.forbidden('Apenas o proprietário pode atribuir o papel de proprietário.');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (b.name     !== undefined) updateData.name   = b.name;
    if (b.role     !== undefined) updateData.role   = b.role;
    if (b.status   !== undefined) updateData.status = b.status;
    if (b.password !== undefined) updateData.password_hash = await bcrypt.hash(b.password, 12);

    if (!Object.keys(updateData).length) return reply.badRequest('Nenhum campo para atualizar');

    const [updated] = await db.update(users)
      .set(updateData as any)
      .where(and(eq(users.id, id), eq(users.tenant_id, tenantId)))
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status });
    return updated;
  });

  /* ── DELETE /v1/users/:id (soft-delete) ────────────────────────────── */
  fastify.delete('/users/:id', {
    onRequest: [authenticate], preHandler: [requirePermission('users:delete')],
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const result = await db.update(users)
      .set({ status: 'disabled' })
      .where(and(eq(users.id, id), eq(users.tenant_id, tenantId), eq(users.status, 'active')));

    if (!result.rowCount) return reply.notFound('Usuário não encontrado ou já desabilitado');
    return reply.code(204).send();
  });
};
