import { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, roles, rolePermissions } from '../db';
import { requirePermission } from '../lib/requirePermission';
import { invalidatePermissionCache } from '../rbac/permissionService';
import { PERMISSION_CATALOG, MODULE_LABELS, isPermissionKey } from '../rbac/permissions';

// slug de papel custom: minúsculas, dígitos, '_' e '-' (sem ':' p/ não colidir
// com o formato de permissão).
const ROLE_KEY_RE = /^[a-z][a-z0-9_-]{1,39}$/;

interface RoleRow {
  id: string; tenant_id: string | null; key: string;
  name: string; description: string | null; is_system: boolean;
}

async function loadRolesWithPermissions(tenantId: string) {
  const roleRows = (await db
    .select({
      id: roles.id, tenant_id: roles.tenant_id, key: roles.key,
      name: roles.name, description: roles.description, is_system: roles.is_system,
    })
    .from(roles)
    .where(or(isNull(roles.tenant_id), eq(roles.tenant_id, tenantId)))) as RoleRow[];

  const ids = roleRows.map((r) => r.id);
  const permRows = ids.length
    ? await db.select({ role_id: rolePermissions.role_id, permission_key: rolePermissions.permission_key })
        .from(rolePermissions).where(inArray(rolePermissions.role_id, ids))
    : [];

  const byRole = new Map<string, string[]>();
  for (const p of permRows) {
    const arr = byRole.get(p.role_id) ?? [];
    arr.push(p.permission_key);
    byRole.set(p.role_id, arr);
  }

  return roleRows.map((r) => ({
    id: r.id, key: r.key, name: r.name, description: r.description,
    is_system: r.is_system, is_custom: r.tenant_id !== null,
    permissions: (byRole.get(r.id) ?? []).sort(),
  }));
}

export const rbacRoutes: FastifyPluginAsync = async (fastify) => {
  const authenticate = (fastify as any).authenticate;

  /* ── GET /v1/rbac/permissions — catálogo de permissões ──────────────── */
  fastify.get('/rbac/permissions', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:view')],
  }, async () => ({
    modules: MODULE_LABELS,
    permissions: PERMISSION_CATALOG,
  }));

  /* ── GET /v1/rbac/roles — papéis de sistema + custom do tenant ──────── */
  fastify.get('/rbac/roles', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:view')],
  }, async (request) => {
    const { tenantId } = (request as any).user;
    return { data: await loadRolesWithPermissions(tenantId) };
  });

  /* ── POST /v1/rbac/roles — cria papel custom ────────────────────────── */
  fastify.post('/rbac/roles', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:manage')],
    schema: {
      body: {
        type: 'object',
        required: ['key', 'name'],
        properties: {
          key:         { type: 'string', minLength: 2, maxLength: 40 },
          name:        { type: 'string', minLength: 2, maxLength: 80 },
          description: { type: 'string', maxLength: 200 },
          permissions: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const b = request.body as { key: string; name: string; description?: string; permissions?: string[] };
    const key = b.key.toLowerCase().trim();

    if (!ROLE_KEY_RE.test(key)) {
      return reply.badRequest('Chave inválida: use minúsculas, dígitos, _ ou - (sem espaços).');
    }
    const perms = [...new Set(b.permissions ?? [])];
    const invalid = perms.filter((p) => !isPermissionKey(p));
    if (invalid.length) return reply.badRequest(`Permissões inexistentes: ${invalid.join(', ')}`);

    try {
      const created = await db.transaction(async (tx) => {
        const [role] = await tx.insert(roles).values({
          tenant_id: tenantId, key, name: b.name.trim(),
          description: b.description?.trim() || null, is_system: false,
        }).returning({ id: roles.id });

        if (perms.length) {
          await tx.insert(rolePermissions).values(
            perms.map((permission_key) => ({ role_id: role.id, permission_key })),
          );
        }
        return role;
      });

      invalidatePermissionCache(tenantId);
      return reply.code(201).send({ id: created.id, key, name: b.name.trim(), permissions: perms });
    } catch (err: any) {
      if (err.code === '23505') return reply.conflict('Já existe um papel com essa chave neste tenant.');
      throw err;
    }
  });

  /* ── PATCH /v1/rbac/roles/:id — renomeia papel custom ───────────────── */
  fastify.patch('/rbac/roles/:id', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:manage')],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 2, maxLength: 80 },
          description: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const b = request.body as { name?: string; description?: string };

    const role = await ensureEditableCustomRole(id, tenantId, reply);
    if (!role) return;

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (b.name !== undefined) patch.name = b.name.trim();
    if (b.description !== undefined) patch.description = b.description.trim() || null;

    const [updated] = await db.update(roles).set(patch as any).where(eq(roles.id, id))
      .returning({ id: roles.id, key: roles.key, name: roles.name, description: roles.description });
    return updated;
  });

  /* ── PUT /v1/rbac/roles/:id/permissions — define permissões ─────────── */
  fastify.put('/rbac/roles/:id/permissions', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:manage')],
    schema: {
      body: {
        type: 'object',
        required: ['permissions'],
        properties: { permissions: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };
    const perms = [...new Set((request.body as { permissions: string[] }).permissions)];

    const role = await ensureEditableCustomRole(id, tenantId, reply);
    if (!role) return;

    const invalid = perms.filter((p) => !isPermissionKey(p));
    if (invalid.length) return reply.badRequest(`Permissões inexistentes: ${invalid.join(', ')}`);

    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.role_id, id));
      if (perms.length) {
        await tx.insert(rolePermissions).values(
          perms.map((permission_key) => ({ role_id: id, permission_key })),
        );
      }
    });

    invalidatePermissionCache(tenantId);
    return { id, permissions: perms.sort() };
  });

  /* ── DELETE /v1/rbac/roles/:id — remove papel custom ────────────────── */
  fastify.delete('/rbac/roles/:id', {
    onRequest: [authenticate], preHandler: [requirePermission('roles:manage')],
  }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { id } = request.params as { id: string };

    const role = await ensureEditableCustomRole(id, tenantId, reply);
    if (!role) return;

    // Não excluir papel em uso — evita usuários órfãos de permissão.
    const { rows } = await db.execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = ${tenantId} AND role = ${role.key}`,
    );
    if ((rows[0]?.n ?? 0) > 0) {
      return reply.conflict('Papel em uso por usuários — reatribua os usuários antes de excluir.');
    }

    await db.delete(roles).where(eq(roles.id, id));
    invalidatePermissionCache(tenantId);
    return reply.code(204).send();
  });

  // Garante que o papel existe, é custom e pertence ao tenant. Responde e
  // retorna null caso contrário.
  async function ensureEditableCustomRole(id: string, tenantId: string, reply: any) {
    const [role] = (await db
      .select({ id: roles.id, tenant_id: roles.tenant_id, key: roles.key, is_system: roles.is_system })
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenant_id, tenantId)))) as RoleRow[];

    if (!role) { reply.notFound('Papel não encontrado'); return null; }
    if (role.is_system) { reply.badRequest('Papel de sistema não pode ser alterado.'); return null; }
    return role;
  }
};
