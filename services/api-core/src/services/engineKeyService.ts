// Gestão de chaves do Fiscal Engine + medição de uso. O segredo aparece UMA
// vez (retorno do create) e nunca é recuperável — perda de segredo = revogar
// e criar outra. Revogação é soft (status) para manter api_key_usage auditável.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { apiKeys } from '../db/schema';
import { generateApiKey } from '../lib/apiKeyAuth';

export type DrizzleDB = typeof _db;

export class EngineKeyError extends Error {
  constructor(public code: 'key_name_required' | 'key_not_found' | 'key_limit_reached') {
    super(code); this.name = 'EngineKeyError';
  }
}

// Teto por tenant — proteção contra vazamento de criação em loop; não é
// limite comercial (sobe quando houver plano pago com mais chaves).
const MAX_KEYS_PER_TENANT = 10;

export interface CreatedKey {
  id: string;
  name: string;
  secret: string;       // única vez!
  key_prefix: string;
  rate_limit_per_min: number;
  created_at: Date;
}

export async function createKey(
  tenantId: string, name: string, createdBy: string | null, db: DrizzleDB = _db,
): Promise<CreatedKey> {
  if (!name?.trim()) throw new EngineKeyError('key_name_required');

  const existing = await db.select({ id: apiKeys.id }).from(apiKeys)
    .where(and(eq(apiKeys.tenant_id, tenantId), eq(apiKeys.status, 'active')));
  if (existing.length >= MAX_KEYS_PER_TENANT) throw new EngineKeyError('key_limit_reached');

  const gen = generateApiKey();
  const [row] = await db.insert(apiKeys).values({
    tenant_id: tenantId, name: name.trim(),
    key_prefix: gen.keyPrefix, key_hash: gen.keyHash,
    created_by: createdBy,
  }).returning();

  return {
    id: row.id, name: row.name, secret: gen.secret, key_prefix: row.key_prefix,
    rate_limit_per_min: Number(row.rate_limit_per_min), created_at: row.created_at,
  };
}

/** Lista SEM segredo e sem hash — só metadados. */
export async function listKeys(tenantId: string, db: DrizzleDB = _db) {
  const rows = await db.select({
    id: apiKeys.id, name: apiKeys.name, key_prefix: apiKeys.key_prefix,
    status: apiKeys.status, rate_limit_per_min: apiKeys.rate_limit_per_min,
    last_used_at: apiKeys.last_used_at, created_at: apiKeys.created_at,
  }).from(apiKeys).where(eq(apiKeys.tenant_id, tenantId)).orderBy(desc(apiKeys.created_at));
  return rows;
}

export async function revokeKey(tenantId: string, keyId: string, db: DrizzleDB = _db) {
  const [row] = await db.update(apiKeys)
    .set({ status: 'revoked', revoked_at: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenant_id, tenantId)))
    .returning({ id: apiKeys.id });
  if (!row) throw new EngineKeyError('key_not_found');
  return { id: row.id, status: 'revoked' as const };
}

/** UPSERT increment em api_key_usage — fire-and-forget nas rotas do engine. */
export async function recordUsage(apiKeyId: string, endpoint: string, db: DrizzleDB = _db): Promise<void> {
  await db.execute(sql`
    INSERT INTO api_key_usage (api_key_id, dia, endpoint, count)
    VALUES (${apiKeyId}, CURRENT_DATE, ${endpoint}, 1)
    ON CONFLICT (api_key_id, dia, endpoint) DO UPDATE SET count = api_key_usage.count + 1
  `);
}

/** Uso agregado por dia/endpoint dos últimos N dias (painel do tenant). */
export async function usageSummary(tenantId: string, days: number, db: DrizzleDB = _db) {
  const { rows } = await db.execute<{ dia: string; endpoint: string; total: string }>(sql`
    SELECT u.dia::text, u.endpoint, SUM(u.count) AS total
    FROM api_key_usage u
    JOIN api_keys k ON k.id = u.api_key_id
    WHERE k.tenant_id = ${tenantId} AND u.dia >= CURRENT_DATE - ${days}::int
    GROUP BY u.dia, u.endpoint
    ORDER BY u.dia DESC, u.endpoint
  `);
  return rows.map((r) => ({ dia: r.dia, endpoint: r.endpoint, total: Number(r.total) }));
}
