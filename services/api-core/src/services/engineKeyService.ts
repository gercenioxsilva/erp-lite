// Gestão de chaves de API + medição de uso — nasceu com o Fiscal Engine
// (0080) e passou a servir também a Captação de Leads (0084): a lógica de
// criar/listar/revogar/medir é genérica por natureza, só o conjunto de
// scopes/tipo de chave muda por chamador (routes/engineKeys.ts vs
// routes/leadCaptureKeys.ts). O segredo aparece UMA vez (retorno do create)
// e nunca é recuperável — perda de segredo = revogar e criar outra.
// Revogação é soft (status) para manter api_key_usage auditável.

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

export interface CreateKeyOptions {
  scopes?:          string[];
  keyType?:         'secret' | 'publishable';
  rateLimitPerMin?: number;
  allowedOrigins?:  string[] | null;
}

/**
 * Default preserva exatamente o comportamento original do Fiscal Engine
 * (scopes=['engine'], keyType='secret', rate limit da coluna=60) — chamadores
 * existentes (`routes/engineKeys.ts`) continuam funcionando sem passar opts.
 */
export async function createKey(
  tenantId: string, name: string, createdBy: string | null, db: DrizzleDB = _db,
  opts: CreateKeyOptions = {},
): Promise<CreatedKey> {
  if (!name?.trim()) throw new EngineKeyError('key_name_required');

  const existing = await db.select({ id: apiKeys.id }).from(apiKeys)
    .where(and(eq(apiKeys.tenant_id, tenantId), eq(apiKeys.status, 'active')));
  if (existing.length >= MAX_KEYS_PER_TENANT) throw new EngineKeyError('key_limit_reached');

  const keyType = opts.keyType ?? 'secret';
  const gen = generateApiKey(keyType);
  const values: Record<string, unknown> = {
    tenant_id: tenantId, name: name.trim(),
    key_prefix: gen.keyPrefix, key_hash: gen.keyHash,
    key_type: keyType,
    created_by: createdBy,
  };
  if (opts.scopes)          values.scopes = opts.scopes;
  if (opts.rateLimitPerMin) values.rate_limit_per_min = opts.rateLimitPerMin;
  if (opts.allowedOrigins)  values.allowed_origins = opts.allowedOrigins;

  const [row] = await db.insert(apiKeys).values(values as any).returning();

  return {
    id: row.id, name: row.name, secret: gen.secret, key_prefix: row.key_prefix,
    rate_limit_per_min: Number(row.rate_limit_per_min), created_at: row.created_at,
  };
}

/**
 * Lista SEM segredo e sem hash — só metadados. `scopeFilter` restringe às
 * chaves daquele escopo (ex.: 'engine' vs 'leads:create') — sem isso, um
 * tenant com os dois tipos de chave veria tudo misturado em qualquer uma das
 * duas telas. Filtra em memória (teto de MAX_KEYS_PER_TENANT por tenant,
 * sem custo real) em vez de um operador JSONB no SQL, por simplicidade.
 */
export async function listKeys(tenantId: string, db: DrizzleDB = _db, scopeFilter?: string) {
  const rows = await db.select({
    id: apiKeys.id, name: apiKeys.name, key_prefix: apiKeys.key_prefix,
    status: apiKeys.status, rate_limit_per_min: apiKeys.rate_limit_per_min,
    key_type: apiKeys.key_type, scopes: apiKeys.scopes,
    last_used_at: apiKeys.last_used_at, created_at: apiKeys.created_at,
  }).from(apiKeys).where(eq(apiKeys.tenant_id, tenantId)).orderBy(desc(apiKeys.created_at));

  if (!scopeFilter) return rows;
  return rows.filter(r => Array.isArray(r.scopes) && (r.scopes as string[]).includes(scopeFilter));
}

/**
 * `scopeFilter` impede que a tela de gestão de um escopo (ex.: Captação de
 * Leads) revogue por engano uma chave de outro escopo do mesmo tenant (ex.:
 * Engine) — o `tenant_id` já isola entre tenants, isto isola entre telas.
 */
export async function revokeKey(tenantId: string, keyId: string, db: DrizzleDB = _db, scopeFilter?: string) {
  const [current] = await db.select({ id: apiKeys.id, scopes: apiKeys.scopes }).from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenant_id, tenantId)));
  if (!current) throw new EngineKeyError('key_not_found');
  if (scopeFilter && !(Array.isArray(current.scopes) && (current.scopes as string[]).includes(scopeFilter))) {
    throw new EngineKeyError('key_not_found');
  }

  const [row] = await db.update(apiKeys)
    .set({ status: 'revoked', revoked_at: new Date() })
    .where(eq(apiKeys.id, keyId))
    .returning({ id: apiKeys.id });
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
