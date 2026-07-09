// Application Service — Controle de Perfil de Acesso (RBAC). Orquestra I/O +
// transação: perfis configuráveis por tenant, grants de permissão, atribuição
// de perfil a usuário, e resolução de permissões efetivas (usada tanto pelo
// preHandler requirePermission() quanto pelo bootstrap do frontend).
//
// Toda mutação exige actorRole='owner' verificado aqui via
// assertActorIsOwner() — defesa em profundidade: a rota já aplica
// requireRole('owner') como preHandler, mas uma regra de autorização deste
// nível (quem pode mudar permissão de quem) não deveria depender só do
// ponto de entrada HTTP.

import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { accessProfiles, accessProfilePermissions, accessProfileEvents, users } from '../db/schema';
import {
  AccessControlDomainError, validateProfileName, assertProfileDeletable, assertActorIsOwner,
  assertCanAssignAccessProfile, isPermissionResource, isPermissionAction,
  resolveEffectivePermissions, DEFAULT_PROFILES,
  type PermissionGrant, type EffectivePermissions,
} from '../domain/accessControl/accessControlDomain';

export type DrizzleDB = typeof _db;
export { AccessControlDomainError };

// ── Perfis ──────────────────────────────────────────────────────────────────────

/** Perfis do tenant — semeia os 3 perfis padrão na primeira leitura se o
 * tenant ainda não tem nenhum (idempotente, mesmo idioma de listStages() no
 * Funil de Vendas). Leitura pura — não exige actorRole. */
export async function listProfiles(tenantId: string, db: DrizzleDB = _db) {
  const existing = await db.select().from(accessProfiles).where(eq(accessProfiles.tenant_id, tenantId));
  if (existing.length > 0) return existing;

  return db.transaction(async (tx) => {
    const seeded = [];
    for (const template of DEFAULT_PROFILES) {
      const [profile] = await tx.insert(accessProfiles).values({
        tenant_id: tenantId, name: template.name, description: template.description, is_system: true,
      }).returning();

      if (template.grants.length) {
        await tx.insert(accessProfilePermissions).values(
          template.grants.map(g => ({
            tenant_id: tenantId, access_profile_id: profile.id, resource: g.resource, action: g.action,
          })),
        );
      }
      seeded.push(profile);
    }
    return seeded;
  });
}

async function getProfileOrThrow(id: string, tenantId: string, db: DrizzleDB) {
  const [profile] = await db.select().from(accessProfiles)
    .where(and(eq(accessProfiles.id, id), eq(accessProfiles.tenant_id, tenantId)));
  if (!profile) throw new AccessControlDomainError('profile_not_found', { id });
  return profile;
}

export interface CreateProfileArgs {
  tenantId: string; actorRole: string; name: string; description?: string | null; changedBy?: string | null;
}

export async function createProfile(args: CreateProfileArgs, db: DrizzleDB = _db) {
  assertActorIsOwner(args.actorRole);
  validateProfileName(args.name);

  return db.transaction(async (tx) => {
    const [profile] = await tx.insert(accessProfiles).values({
      tenant_id: args.tenantId, name: args.name.trim(), description: args.description || null,
    }).returning();

    await tx.insert(accessProfileEvents).values({
      tenant_id: args.tenantId, access_profile_id: profile.id, type: 'created',
      changed_by: args.changedBy || null, payload: { name: profile.name },
    });

    return profile;
  });
}

export interface UpdateProfileArgs { actorRole: string; name?: string; description?: string | null; changedBy?: string | null; }

export async function updateProfile(id: string, tenantId: string, args: UpdateProfileArgs, db: DrizzleDB = _db) {
  assertActorIsOwner(args.actorRole);
  await getProfileOrThrow(id, tenantId, db);
  if (args.name !== undefined) validateProfileName(args.name);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name        !== undefined) patch.name        = args.name.trim();
  if (args.description !== undefined) patch.description = args.description || null;

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(accessProfiles).set(patch)
      .where(eq(accessProfiles.id, id)).returning();

    if (args.name !== undefined) {
      await tx.insert(accessProfileEvents).values({
        tenant_id: tenantId, access_profile_id: id, type: 'renamed',
        changed_by: args.changedBy || null, payload: { name: updated.name },
      });
    }

    return updated;
  });
}

export async function deleteProfile(
  id: string, tenantId: string, actorRole: string, changedBy: string | null, db: DrizzleDB = _db,
) {
  assertActorIsOwner(actorRole);
  await getProfileOrThrow(id, tenantId, db);

  const [{ count }] = await db.select({ count: sql<number>`COUNT(*)::int` })
    .from(users).where(eq(users.access_profile_id, id));
  assertProfileDeletable(count);

  await db.transaction(async (tx) => {
    await tx.delete(accessProfiles).where(eq(accessProfiles.id, id));
    await tx.insert(accessProfileEvents).values({
      tenant_id: tenantId, access_profile_id: null, type: 'deleted',
      changed_by: changedBy || null, payload: { profileId: id },
    });
  });
}

// ── Permissões (grants) ────────────────────────────────────────────────────────

export async function listProfilePermissions(profileId: string, tenantId: string, db: DrizzleDB = _db) {
  await getProfileOrThrow(profileId, tenantId, db);
  return db.select().from(accessProfilePermissions)
    .where(and(eq(accessProfilePermissions.access_profile_id, profileId), eq(accessProfilePermissions.tenant_id, tenantId)));
}

/** Substitui todos os grants do perfil pelos informados (replace-all
 * transacional, mesmo padrão já usado na edição de itens de Pedido de
 * Compra/NF-e de Entrada) + loga a auditoria. */
export async function setProfilePermissions(
  profileId: string, tenantId: string, grants: PermissionGrant[], actorRole: string, changedBy: string | null, db: DrizzleDB = _db,
) {
  assertActorIsOwner(actorRole);
  await getProfileOrThrow(profileId, tenantId, db);

  const valid = grants.filter(g => isPermissionResource(g.resource) && isPermissionAction(g.action));

  return db.transaction(async (tx) => {
    await tx.delete(accessProfilePermissions).where(eq(accessProfilePermissions.access_profile_id, profileId));

    if (valid.length) {
      await tx.insert(accessProfilePermissions).values(
        valid.map(g => ({ tenant_id: tenantId, access_profile_id: profileId, resource: g.resource, action: g.action })),
      );
    }

    await tx.insert(accessProfileEvents).values({
      tenant_id: tenantId, access_profile_id: profileId, type: 'permissions_changed',
      changed_by: changedBy || null, payload: { grants: valid },
    });

    return valid;
  });
}

// ── Atribuição de perfil a usuário ─────────────────────────────────────────────

export async function assignUserProfile(
  userId: string, tenantId: string, profileId: string | null, actorRole: string, changedBy: string | null, db: DrizzleDB = _db,
) {
  assertActorIsOwner(actorRole);

  const [target] = await db.select({ id: users.id, role: users.role }).from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)));
  if (!target) throw new AccessControlDomainError('user_not_found', { id: userId });

  assertCanAssignAccessProfile(target.role);
  if (profileId) await getProfileOrThrow(profileId, tenantId, db);

  const [updated] = await db.update(users).set({ access_profile_id: profileId, updated_at: new Date() })
    .where(eq(users.id, userId)).returning({ id: users.id, access_profile_id: users.access_profile_id });

  await db.insert(accessProfileEvents).values({
    tenant_id: tenantId, access_profile_id: profileId, type: 'user_assigned',
    changed_by: changedBy || null, payload: { userId },
  });

  return updated;
}

// ── Permissões efetivas ─────────────────────────────────────────────────────────

/** Resolve as permissões efetivas de um usuário — usado tanto pelo
 * preHandler requirePermission() quanto pelo endpoint de bootstrap
 * GET /v1/me/permissions do frontend. owner nunca depende de perfil (bypass
 * total já resolvido no domínio). Leitura pura — não exige actorRole. */
export async function getEffectivePermissions(
  userId: string, tenantId: string, db: DrizzleDB = _db,
): Promise<EffectivePermissions> {
  const [user] = await db.select({ role: users.role, access_profile_id: users.access_profile_id })
    .from(users).where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)));
  if (!user) return resolveEffectivePermissions('user', []);

  if (user.role === 'owner' || !user.access_profile_id) {
    return resolveEffectivePermissions(user.role, []);
  }

  const grants = await db.select({ resource: accessProfilePermissions.resource, action: accessProfilePermissions.action })
    .from(accessProfilePermissions)
    .where(and(
      eq(accessProfilePermissions.access_profile_id, user.access_profile_id),
      eq(accessProfilePermissions.tenant_id, tenantId),
    ));

  return resolveEffectivePermissions(user.role, grants as PermissionGrant[]);
}
