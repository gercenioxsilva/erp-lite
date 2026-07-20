// Autenticação por API key do Fiscal Engine (padrão Stripe): o segredo
// completo (ek_live_<32 hex>) só existe no momento da criação — o banco
// guarda SHA-256 + um prefixo curto para lookup. Verificação em 2 passos:
// busca por key_prefix (índice único) e comparação do hash com
// timingSafeEqual (nunca === em segredo).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyReply, FastifyRequest } from 'fastify';
import { db as _db } from '../db';
import { apiKeys } from '../db/schema';
import { allowRequest, remainingRequests } from './rateLimiter';
import { isModuleEnabled, type ModuleKey } from '../services/tenantModuleService';

export type DrizzleDB = typeof _db;

export const API_KEY_HEADER = 'x-api-key';
const KEY_ENV = 'live'; // 'test' reservado — sem semântica na v1
const PREFIX_LEN = 12;  // 'ek_live_'/'pk_live_' + 4 hex — cabe no VARCHAR(20) com folga

export interface GeneratedApiKey {
  secret: string;      // ek_live_<32 hex> (secret) ou pk_live_<32 hex> (publishable) — mostrado UMA vez, nunca armazenado
  keyPrefix: string;   // primeiros 12 chars — lookup
  keyHash: string;     // SHA-256 hex do segredo completo
}

// 'ek_' (Engine Key, secret — nunca deve rodar fora de um backend) vs 'pk_'
// (Publishable Key — segura pra embutir em JS client-side, padrão Stripe).
// O prefixo é só uma pista visual pra quem está integrando; a garantia real
// de escopo fica em api_keys.key_type + scopes, nunca no texto do prefixo.
const SECRET_KEY_PREFIX      = 'ek_';
const PUBLISHABLE_KEY_PREFIX = 'pk_';

export function generateApiKey(keyType: 'secret' | 'publishable' = 'secret'): GeneratedApiKey {
  const tag = keyType === 'publishable' ? PUBLISHABLE_KEY_PREFIX : SECRET_KEY_PREFIX;
  const secret = `${tag}${KEY_ENV}_${randomBytes(16).toString('hex')}`;
  return { secret, keyPrefix: secret.slice(0, PREFIX_LEN), keyHash: hashApiKey(secret) };
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Comparação constante entre hash armazenado e hash do candidato. */
export function verifyApiKeyHash(storedHash: string, candidateSecret: string): boolean {
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hashApiKey(candidateSecret), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AuthenticatedApiKey {
  id: string;
  tenantId: string;
  name: string;
  scopes: string[];
  rateLimitPerMin: number;
}

/**
 * preHandler de rotas autenticadas por API key (hoje: /v1/engine/* e
 * /v1/public/leads): valida a chave, aplica o rate limit e anexa
 * request.apiKey. Respostas de erro seguem o envelope {success,error}.
 *
 * `moduleKey` é o módulo (`tenant_modules`) que serve de kill-switch pra
 * TODAS as chaves daquele recurso — desligar o módulo em Minha Empresa corta
 * o acesso na hora, sem precisar revogar chave por chave. Default 'engine'
 * preserva o único chamador existente (`routes/engine.ts`) sem mudança.
 */
export function requireApiKey(scope: string, moduleKey: ModuleKey = 'engine', db: DrizzleDB = _db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = request.headers[API_KEY_HEADER];
    if (typeof secret !== 'string' || !(secret.startsWith(SECRET_KEY_PREFIX) || secret.startsWith(PUBLISHABLE_KEY_PREFIX))) {
      return reply.code(401).send({ success: false, error: 'api_key_missing' });
    }

    const [row] = await db.select().from(apiKeys)
      .where(eq(apiKeys.key_prefix, secret.slice(0, PREFIX_LEN)));
    if (!row || row.status !== 'active' || !verifyApiKeyHash(row.key_hash, secret)) {
      return reply.code(401).send({ success: false, error: 'api_key_invalid' });
    }

    const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
    if (!scopes.includes(scope)) {
      return reply.code(403).send({ success: false, error: 'api_key_scope_denied', scope });
    }

    // Toggle por tenant (mesmo contrato dos módulos internos): desligar o
    // módulo em Minha Empresa corta TODAS as chaves do tenant na hora — sem
    // isso seria o único recurso impossível de desabilitar de uma vez.
    if (!(await isModuleEnabled(row.tenant_id, moduleKey, db))) {
      return reply.code(403).send({ success: false, error: 'module_disabled' });
    }

    // Allowlist de origem — SÓ defesa em profundidade (reduz abuso casual de
    // uma chave publicável vazada), NUNCA a garantia real: Origin/Referer são
    // forjáveis por qualquer chamada fora de um browser de verdade (curl,
    // script). A garantia de verdade continua sendo rate limit + escopo +
    // validação de campo no domínio.
    const allowedOrigins = Array.isArray(row.allowed_origins) ? (row.allowed_origins as string[]) : null;
    if (allowedOrigins?.length) {
      const origin = String(request.headers.origin ?? request.headers.referer ?? '');
      const allowed = allowedOrigins.some(o => origin.startsWith(o));
      if (!allowed) {
        return reply.code(403).send({ success: false, error: 'api_key_origin_denied' });
      }
    }

    const limit = Number(row.rate_limit_per_min) || 60;
    if (!allowRequest(row.id, limit)) {
      reply.header('Retry-After', '60');
      return reply.code(429).send({ success: false, error: 'rate_limit_exceeded', limit_per_min: limit });
    }
    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(remainingRequests(row.id, limit)));

    (request as any).apiKey = {
      id: row.id, tenantId: row.tenant_id, name: row.name,
      scopes, rateLimitPerMin: limit,
    } satisfies AuthenticatedApiKey;

    // last_used_at é telemetria — nunca bloqueia nem derruba a request.
    db.update(apiKeys).set({ last_used_at: new Date() }).where(eq(apiKeys.id, row.id))
      .catch(() => { /* fire-and-forget */ });
  };
}
