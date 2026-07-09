import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { db, users } from '../db';
import { sendSystemNotification } from '../lib/notificationsClient';
import { requireRole } from '../lib/requireRole';
import { assignUserProfile, AccessControlDomainError } from '../services/accessControlService';

// ── Achado de segurança corrigido nesta entrega (RBAC) ──────────────────────
// Antes: GET confiava em tenant_id vindo da query string, e PATCH/DELETE não
// filtravam tenant_id nenhum — um usuário autenticado de QUALQUER tenant
// conseguia listar/editar/desativar usuários de outro tenant só sabendo (ou
// adivinhando) o UUID, inclusive promovendo alguém a role='owner'. `users` é
// a tabela mais sensível do sistema (é literalmente quem consegue logar como
// quem) — daqui pra baixo, tenant_id SEMPRE vem de request.user.tenantId
// (JWT), nunca de query/body, em toda rota deste arquivo.

export const usersRoutes: FastifyPluginAsync = async (fastify) => {
  const auth      = { onRequest: [(fastify as any).authenticate] };
  const ownerOnly = { onRequest: [(fastify as any).authenticate], preHandler: [requireRole('owner')] };

  function handleDomainError(err: unknown, reply: any) {
    if (err instanceof AccessControlDomainError) {
      if (err.code === 'user_not_found' || err.code === 'profile_not_found') return reply.notFound(err.code);
      if (err.code === 'actor_not_owner') return reply.code(403).send({ error: err.code });
      return reply.code(422).send({ error: err.code, ...err.payload });
    }
    throw err;
  }

  /* ── GET /v1/users ──────────────────────────────────────────────────── */
  fastify.get('/users', auth, async (request) => {
    const tenantId = (request as any).user.tenantId;
    const { search, page = '1', per_page = '20' } = request.query as Record<string, string>;

    const limit  = Math.min(Number(per_page) || 20, 100);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const baseWhere = eq(users.tenant_id, tenantId);
    const where = search
      ? and(baseWhere, or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`)))
      : baseWhere;

    const [rows, [cnt]] = await Promise.all([
      db.select({ id: users.id, email: users.email, name: users.name, role: users.role,
                  status: users.status, access_profile_id: users.access_profile_id, created_at: users.created_at })
        .from(users).where(where)
        .orderBy(sql`${users.name} ASC`)
        .limit(limit).offset(offset),
      db.select({ count: sql<number>`COUNT(*)::int` }).from(users).where(where),
    ]);

    return { data: rows, total: cnt.count, page: Number(page), per_page: limit };
  });

  /* ── POST /v1/users — owner apenas ─────────────────────────────────────── */
  fastify.post('/users', {
    ...ownerOnly,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:     { type: 'string', format: 'email' },
          name:      { type: 'string', maxLength: 255 },
          password:  { type: 'string', minLength: 8 },
          access_profile_id: { type: 'string', format: 'uuid', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { email, name, password, access_profile_id } = request.body as {
      email: string; name?: string; password: string; access_profile_id?: string | null;
    };

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName  = name?.trim() || email.split('@')[0];

    try {
      const [user] = await db.insert(users).values({
        tenant_id: tenantId, email, name: displayName, password_hash: passwordHash,
        role: 'user', status: 'active', access_profile_id: access_profile_id || null,
      }).returning({ id: users.id, email: users.email, name: users.name, role: users.role,
                    status: users.status, access_profile_id: users.access_profile_id, created_at: users.created_at });

      // Send welcome e-mail with credentials — fire-and-forget, never blocks user creation
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
      }).catch(() => { /* e-mail failure must not fail the API response */ });

      return reply.code(201).send(user);
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('E-mail já cadastrado neste tenant');
      throw err;
    }
  });

  /* ── PATCH /v1/users/:id — owner apenas ────────────────────────────────── */
  fastify.patch('/users/:id', {
    ...ownerOnly,
    schema: {
      body: {
        type: 'object',
        properties: {
          name:               { type: 'string', maxLength: 255 },
          status:             { type: 'string', enum: ['active', 'disabled'] },
          password:           { type: 'string', minLength: 8 },
          access_profile_id:  { type: 'string', format: 'uuid', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const actorRole = (request as any).user.role;
    const changedBy = (request as any).user.userId;
    const { id } = request.params as { id: string };
    const b = request.body as { name?: string; status?: string; password?: string; access_profile_id?: string | null };

    const [existing] = await db.select({ id: users.id, role: users.role })
      .from(users).where(and(eq(users.id, id), eq(users.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Usuário não encontrado');

    // owner nunca pode ser desabilitado por esta rota (nem por si, nem por
    // outro owner) — não existe caminho de recuperação depois disso.
    if (existing.role === 'owner' && b.status === 'disabled') {
      return reply.code(422).send({ error: 'cannot_disable_owner' });
    }

    try {
      if (b.access_profile_id !== undefined) {
        await assignUserProfile(id, tenantId, b.access_profile_id, actorRole, changedBy);
      }

      const updateData: Record<string, unknown> = {};
      if (b.name     !== undefined) updateData.name   = b.name;
      if (b.status   !== undefined) updateData.status = b.status;
      if (b.password !== undefined) updateData.password_hash = await bcrypt.hash(b.password, 12);

      if (Object.keys(updateData).length) {
        await db.update(users).set(updateData as any).where(and(eq(users.id, id), eq(users.tenant_id, tenantId)));
      } else if (b.access_profile_id === undefined) {
        return reply.badRequest('Nenhum campo para atualizar');
      }

      const [updated] = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role,
                                          status: users.status, access_profile_id: users.access_profile_id })
        .from(users).where(and(eq(users.id, id), eq(users.tenant_id, tenantId)));
      return updated;
    } catch (err) { return handleDomainError(err, reply); }
  });

  /* ── DELETE /v1/users/:id (soft-delete) — owner apenas ─────────────────── */
  fastify.delete('/users/:id', ownerOnly, async (request, reply) => {
    const tenantId = (request as any).user.tenantId;
    const { id }   = request.params as { id: string };

    const [existing] = await db.select({ id: users.id, role: users.role })
      .from(users).where(and(eq(users.id, id), eq(users.tenant_id, tenantId)));
    if (!existing) return reply.notFound('Usuário não encontrado ou já desabilitado');
    if (existing.role === 'owner') return reply.code(422).send({ error: 'cannot_disable_owner' });

    const result = await db.update(users)
      .set({ status: 'disabled' })
      .where(and(eq(users.id, id), eq(users.tenant_id, tenantId), eq(users.status, 'active')));

    if (!result.rowCount) return reply.notFound('Usuário não encontrado ou já desabilitado');
    return reply.code(204).send();
  });
};
