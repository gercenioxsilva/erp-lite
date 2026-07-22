// Trilha append-only de chamadas às integrações (0087) — alimenta a listagem
// "Logs de integração" no rodapé da tela de Integrações.
//
// Regra dura: gravar log NUNCA pode derrubar a operação que está sendo logada.
// record() engole o próprio erro (e só avisa no console) — um INSERT falho de
// auditoria não pode fazer uma transmissão de PGDAS-D bem-sucedida virar 500.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import { integrationLogs } from '../../db/schema';
import type { IntegrationEnvironment, ProviderKey } from './catalog';

export type DrizzleDB = typeof _db;

export interface RecordLogArgs {
  tenantId:    string;
  providerKey: ProviderKey;
  environment: IntegrationEnvironment | null;
  /** Operação: 'ping', 'transmitir', 'gerar_das', 'sync', 'emitir'... */
  service:     string;
  status:      'success' | 'error';
  httpStatus?: number | null;
  latencyMs?:  number | null;
  errorCode?:  string | null;
  detail?:     unknown;
}

// Qualquer chave cujo nome bata com isto é substituída por '[redacted]' antes
// de persistir. Casa por SUBSTRING minúscula, então 'consumer_secret',
// 'pfx_base64' e 'Authorization' caem todos aqui.
const SECRET_PATTERNS = [
  'secret', 'password', 'senha', 'token', 'pfx', 'authorization',
  'client_id', 'consumer_key', 'apikey', 'api_key', 'credential',
];

const MAX_STRING = 2_000;

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_PATTERNS.some(p => k.includes(p));
}

/**
 * Remove segredos e trunca strings gigantes (corpo de resposta da SERPRO traz
 * PDF em base64 — sem truncar, um log de sucesso pesa megabytes).
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncado]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export async function record(args: RecordLogArgs, db: DrizzleDB = _db): Promise<void> {
  try {
    await db.insert(integrationLogs).values({
      tenant_id:    args.tenantId,
      provider_key: args.providerKey,
      environment:  args.environment,
      service:      args.service,
      status:       args.status,
      http_status:  args.httpStatus ?? null,
      latency_ms:   args.latencyMs ?? null,
      error_code:   args.errorCode ?? null,
      detail:       args.detail === undefined ? null : (redact(args.detail) as any),
    });
  } catch (err) {
    // Auditoria não derruba operação — ver cabeçalho.
    console.error('[integration-logs] falha ao gravar log', err);
  }
}

export interface ListLogsFilters {
  providerKey?: ProviderKey | null;
  status?:      'success' | 'error' | null;
  page?:        number;
  pageSize?:    number;
}

export interface ListLogsResult {
  logs: Array<typeof integrationLogs.$inferSelect>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function list(
  tenantId: string, filters: ListLogsFilters = {}, db: DrizzleDB = _db,
): Promise<ListLogsResult> {
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page     = Math.max(1, filters.page ?? 1);

  const where = and(
    eq(integrationLogs.tenant_id, tenantId),
    filters.providerKey ? eq(integrationLogs.provider_key, filters.providerKey) : undefined,
    filters.status      ? eq(integrationLogs.status, filters.status)            : undefined,
  );

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(integrationLogs)
    .where(where);

  const logs = await db.select().from(integrationLogs)
    .where(where)
    .orderBy(desc(integrationLogs.created_at))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    logs, total: count, page, pageSize,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
  };
}
