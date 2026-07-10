// ── Resolução de permissões de um usuário (runtime) ─────────────────────────
// Permissões NÃO ficam no JWT (o token segue {tenantId,userId,role}). São
// resolvidas aqui por request, com cache curto em memória, e devolvidas ao
// frontend via /auth/login e /auth/me. Assim, mudar o papel/permissões reflete
// sem reemitir token (basta o cache expirar ou invalidar).

import { and, eq, isNull, or } from 'drizzle-orm';
import { db as _db, roles, rolePermissions } from '../db';
import { ALL_PERMISSION_KEYS } from './permissions';

export type DrizzleDB = typeof _db;

const TTL_MS = 60_000;

const cache = new Map<string, Set<string>>();
const cacheExp = new Map<string, number>();

function cacheKey(tenantId: string, role: string): string {
  return `${tenantId}::${role}`;
}

/**
 * Conjunto de permissões efetivas do usuário.
 * - owner: SEMPRE todas (por código) — o dono do tenant nunca fica travado por
 *   uma falha de seed.
 * - demais papéis: resolvidos do banco, preferindo um papel custom do tenant
 *   com a mesma key sobre o papel de sistema.
 */
export async function getPermissionsForUser(
  tenantId: string,
  role: string,
  db: DrizzleDB = _db,
): Promise<Set<string>> {
  if (role === 'owner') return new Set(ALL_PERMISSION_KEYS);

  const key = cacheKey(tenantId, role);
  const now = Date.now();
  const exp = cacheExp.get(key) ?? 0;
  const cached = cache.get(key);
  if (cached && exp > now) return cached;

  const perms = await resolveFromDb(tenantId, role, db);
  cache.set(key, perms);
  cacheExp.set(key, now + TTL_MS);
  return perms;
}

async function resolveFromDb(tenantId: string, role: string, db: DrizzleDB): Promise<Set<string>> {
  const roleRows = await db
    .select({ id: roles.id, tenant_id: roles.tenant_id })
    .from(roles)
    .where(and(eq(roles.key, role), or(eq(roles.tenant_id, tenantId), isNull(roles.tenant_id))));

  if (!roleRows.length) return new Set();

  // Preferir o papel custom do tenant sobre o de sistema de mesma key.
  const chosen = roleRows.find((r) => r.tenant_id === tenantId) ?? roleRows[0];

  const permRows = await db
    .select({ permission_key: rolePermissions.permission_key })
    .from(rolePermissions)
    .where(eq(rolePermissions.role_id, chosen.id));

  return new Set(permRows.map((p) => p.permission_key));
}

/** Lista ordenada — para devolver ao frontend em /auth/login e /auth/me. */
export async function getPermissionsList(
  tenantId: string,
  role: string,
  db: DrizzleDB = _db,
): Promise<string[]> {
  return Array.from(await getPermissionsForUser(tenantId, role, db)).sort();
}

/**
 * Invalida o cache. Sem argumento → limpa tudo (ex.: re-sync de papéis de
 * sistema). Com tenantId → limpa só os papéis daquele tenant (ex.: admin editou
 * um papel custom).
 */
export function invalidatePermissionCache(tenantId?: string): void {
  if (!tenantId) {
    cache.clear();
    cacheExp.clear();
    return;
  }
  const prefix = `${tenantId}::`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      cacheExp.delete(key);
    }
  }
}
