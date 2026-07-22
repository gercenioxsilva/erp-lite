// Credenciais de integração por tenant (0091) — resolução, CRUD e forma pública.
//
// RESOLUÇÃO EM CASCATA (resolveCredentials):
//   1. linha do tenant com enabled=true e todas as obrigatórias preenchidas
//   2. ENV de plataforma (envFallback do catálogo) — mantém funcionando quem já
//      emite hoje pelo token mestre; sem isso, esta migration seria um breaking
//      change silencioso no deploy
//   3. null → o chamador lança IntegrationNotConfiguredError, que as rotas
//      traduzem em 503 com corpo padronizado (NUNCA 500, nunca stack na tela)
//
// A API jamais devolve o VALOR de uma credencial — só se está preenchida. Não
// há rota de leitura de segredo nem por admin: o campo password/file volta
// vazio na edição e um valor vazio no PUT significa "mantém o que está lá"
// (ver mergeCredentials), então ninguém precisa reler para editar o vizinho.

import { and, eq, ne } from 'drizzle-orm';
import { db as _db } from '../../db';
import { integrationProviders } from '../../db/schema';
import {
  CATALOG, PROVIDER_KEYS, requiredFields, isServiceKey,
  type CredentialField, type IntegrationEnvironment, type ProviderKey,
} from './catalog';

export type DrizzleDB = typeof _db;
export type IntegrationRow = typeof integrationProviders.$inferSelect;

/** Erro que as rotas mapeiam em 503 + mensagem genérica na UI. */
export class IntegrationNotConfiguredError extends Error {
  readonly code = 'integration_not_configured';
  constructor(public providerKey: ProviderKey) {
    super('integration_not_configured');
    this.name = 'IntegrationNotConfiguredError';
  }
}

// ── ENV de plataforma (fallback) ─────────────────────────────────────────────

function envValue(field: CredentialField, env: IntegrationEnvironment): string {
  if (!field.envFallback) return '';
  const name = typeof field.envFallback === 'string' ? field.envFallback : field.envFallback[env];
  // `||` e não `??`: compose/ECS declaram env com `${VAR:-}`, que entrega string
  // VAZIA — e vazio aqui significa "não configurado" (mesmo racional do
  // assistantModel() em lib/anthropicClient.ts).
  return process.env[name] || '';
}

/**
 * Ambiente que o ENV de plataforma representa. Cada provider expressa "sandbox"
 * de um jeito próprio; a tela mostra um só conceito.
 */
export function platformEnvironment(key: ProviderKey): IntegrationEnvironment {
  switch (key) {
    case 'serpro':
      return process.env.SERPRO_ENV === 'producao' ? 'production' : 'sandbox';
    case 'pluggy':
      // Convenção 'local-' do pluggyClient liga a simulação.
      return (process.env.PLUGGY_CLIENT_ID || '').startsWith('local-') ? 'sandbox' : 'production';
    case 'google_calendar':
      return 'production';
  }
}

function platformCredentials(key: ProviderKey): Record<string, string> | null {
  const env = platformEnvironment(key);
  const values: Record<string, string> = {};
  for (const field of CATALOG[key].credentials) {
    const v = envValue(field, env);
    if (v) values[field.key] = v;
  }
  const complete = requiredFields(key).every(f => values[f.key]);
  return complete ? values : null;
}

// ── Resolução ────────────────────────────────────────────────────────────────

export interface ResolvedCredentials {
  providerKey: ProviderKey;
  environment: IntegrationEnvironment;
  values: Record<string, string>;
  /** 'tenant' = configurada na tela; 'platform' = caiu no ENV. */
  source: 'tenant' | 'platform';
}

function rowCredentials(row: IntegrationRow): Record<string, string> {
  const raw = (row.credentials ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  return out;
}

function isComplete(key: ProviderKey, values: Record<string, string>): boolean {
  return requiredFields(key).every(f => Boolean(values[f.key]));
}

// ── Serviços habilitados (0092) ──────────────────────────────────────────────

/**
 * NULL = todos habilitados (é o estado das linhas que existiam antes da 0092 —
 * ver o cabeçalho da migration). Array = exatamente os listados.
 */
export function serviceEnabledIn(enabledServices: string[] | null, serviceKey: string): boolean {
  if (enabledServices === null) return true;
  return enabledServices.includes(serviceKey);
}

/**
 * O serviço está ligado para este tenant? Só consulta a linha ATIVA — se a
 * integração está desligada ou caiu no fallback de plataforma, vale o catálogo
 * inteiro (não há configuração de serviço a respeitar).
 */
export async function isServiceEnabled(
  tenantId: string, key: ProviderKey, serviceKey: string, db: DrizzleDB = _db,
): Promise<boolean> {
  const [row] = await db.select().from(integrationProviders)
    .where(and(
      eq(integrationProviders.tenant_id, tenantId),
      eq(integrationProviders.provider_key, key),
      eq(integrationProviders.enabled, true),
    ));
  return serviceEnabledIn(row?.enabled_services ?? null, serviceKey);
}

/** Erro que as rotas mapeiam em 422 — é escolha do tenant, não falha. */
export class IntegrationServiceDisabledError extends Error {
  readonly code = 'integration_service_disabled';
  constructor(public providerKey: ProviderKey, public serviceKey: string) {
    super('integration_service_disabled');
    this.name = 'IntegrationServiceDisabledError';
  }
}

export async function assertServiceEnabled(
  tenantId: string, key: ProviderKey, serviceKey: string, db: DrizzleDB = _db,
): Promise<void> {
  if (!(await isServiceEnabled(tenantId, key, serviceKey, db))) {
    throw new IntegrationServiceDisabledError(key, serviceKey);
  }
}

/**
 * Credencial efetiva do tenant para o provider, ou null se nem o tenant nem a
 * plataforma têm o conjunto obrigatório completo.
 */
export async function resolveCredentials(
  tenantId: string, key: ProviderKey, db: DrizzleDB = _db,
): Promise<ResolvedCredentials | null> {
  const [row] = await db.select().from(integrationProviders)
    .where(and(
      eq(integrationProviders.tenant_id, tenantId),
      eq(integrationProviders.provider_key, key),
      eq(integrationProviders.enabled, true),
    ));

  if (row) {
    const values = rowCredentials(row);
    if (isComplete(key, values)) {
      return {
        providerKey: key,
        environment: row.environment as IntegrationEnvironment,
        values, source: 'tenant',
      };
    }
    // Linha ligada mas incompleta: NÃO cai no ENV. O tenant declarou intenção
    // de usar a conta própria; silenciosamente transmitir pela credencial da
    // plataforma emitiria no CNPJ errado.
    return null;
  }

  const values = platformCredentials(key);
  if (!values) return null;
  return { providerKey: key, environment: platformEnvironment(key), values, source: 'platform' };
}

/** Igual a resolveCredentials, mas lança em vez de devolver null. */
export async function requireCredentials(
  tenantId: string, key: ProviderKey, db: DrizzleDB = _db,
): Promise<ResolvedCredentials> {
  const resolved = await resolveCredentials(tenantId, key, db);
  if (!resolved) throw new IntegrationNotConfiguredError(key);
  return resolved;
}

/** Barato o suficiente para gatear UI (uma query). */
export async function isConfigured(
  tenantId: string, key: ProviderKey, db: DrizzleDB = _db,
): Promise<boolean> {
  return (await resolveCredentials(tenantId, key, db)) !== null;
}

// ── Forma pública (o que a tela recebe) ──────────────────────────────────────

export interface PublicCredentialField {
  key: string;
  label: string;
  type: CredentialField['type'];
  required: boolean;
  help?: string;
  /** Preenchida NA CONFIGURAÇÃO DO TENANT (fallback de plataforma não conta). */
  filled: boolean;
  /**
   * Rabicho mascarado (`••••a1b2`) para o usuário reconhecer QUAL chave está
   * salva sem que a API devolva o segredo. Mesmo compromisso já adotado para os
   * tokens Focus em routes/companies.ts. null quando não há valor ou quando o
   * rabicho não diz nada (arquivo .pfx em base64).
   */
  maskedHint: string | null;
}

/** Últimos 4 caracteres; o resto vira bolinha. Nunca revela o segredo. */
function maskTail(value: string): string | null {
  if (value.length < 8) return '••••';   // curto demais: 4 chars já seriam metade
  return `••••${value.slice(-4)}`;
}

export interface PublicProviderService {
  key: string;
  label: string;
  help?: string;
  enabled: boolean;
}

export interface PublicProviderCard {
  key: ProviderKey;
  label: string;
  description: string;
  moduleKey: string;
  environment: IntegrationEnvironment;
  services: PublicProviderService[];
  enabled: boolean;
  fields: PublicCredentialField[];
  requiredTotal: number;
  requiredFilled: number;
  /** Operacional: dá para chamar a integração (por tenant OU pela plataforma). */
  configured: boolean;
  /** Funcionando pela configuração padrão do sistema, não pela do cliente. */
  usingPlatformFallback: boolean;
  lastPing: { at: string; ok: boolean; message: string | null } | null;
}

function toCard(
  key: ProviderKey, environment: IntegrationEnvironment,
  row: IntegrationRow | undefined, platformOk: boolean,
): PublicProviderCard {
  const def    = CATALOG[key];
  const values = row ? rowCredentials(row) : {};
  const fields = def.credentials.map<PublicCredentialField>(f => ({
    key: f.key, label: f.label, type: f.type, required: f.required,
    ...(f.help ? { help: f.help } : {}),
    filled: Boolean(values[f.key]),
    // Arquivo não ganha rabicho: os últimos 4 chars de um .pfx em base64 não
    // ajudam ninguém a reconhecer o certificado.
    maskedHint: values[f.key] && f.type !== 'file' ? maskTail(values[f.key]) : null,
  }));
  const required   = requiredFields(key);
  const tenantOk   = isComplete(key, values);
  const enabled    = row?.enabled ?? false;
  // Fallback só vale quando o tenant NÃO ligou este provider em ambiente algum
  // — mesma regra do resolveCredentials.
  const usingFallback = !enabled && platformOk && platformEnvironment(key) === environment;

  const services = def.services.map<PublicProviderService>(s => ({
    key: s.key, label: s.label, ...(s.help ? { help: s.help } : {}),
    enabled: serviceEnabledIn(row?.enabled_services ?? null, s.key),
  }));

  return {
    key, label: def.label, description: def.description, moduleKey: def.moduleKey,
    environment, services, enabled, fields,
    requiredTotal:  required.length,
    requiredFilled: required.filter(f => values[f.key]).length,
    configured: (enabled && tenantOk) || usingFallback,
    usingPlatformFallback: usingFallback,
    lastPing: row?.last_ping_at
      ? {
          at: row.last_ping_at.toISOString(),
          ok: row.last_ping_ok ?? false,
          message: row.last_ping_message ?? null,
        }
      : null,
  };
}

/** Um card por par (provider × ambiente suportado) — o layout da tela. */
export async function listProviders(
  tenantId: string, db: DrizzleDB = _db,
): Promise<PublicProviderCard[]> {
  const rows = await db.select().from(integrationProviders)
    .where(eq(integrationProviders.tenant_id, tenantId));

  const cards: PublicProviderCard[] = [];
  for (const key of PROVIDER_KEYS) {
    const platformOk = platformCredentials(key) !== null;
    for (const environment of CATALOG[key].environments) {
      const row = rows.find(r => r.provider_key === key && r.environment === environment);
      cards.push(toCard(key, environment, row, platformOk));
    }
  }
  return cards;
}

// ── Mutações ─────────────────────────────────────────────────────────────────

/**
 * Campo ausente ou string vazia = MANTÉM o valor atual (não dá para reexibir um
 * segredo na tela, então "vazio" não pode significar "apague"). Limpar de fato
 * exige enviar null explícito.
 */
export function mergeCredentials(
  current: Record<string, unknown>, incoming: Record<string, unknown>, key: ProviderKey,
): Record<string, string> {
  const allowed = new Set(CATALOG[key].credentials.map(f => f.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (allowed.has(k) && typeof v === 'string' && v !== '') out[k] = v;
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (!allowed.has(k)) continue;          // campo fora do catálogo é ignorado
    if (v === null) { delete out[k]; continue; }
    if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

async function upsert(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment,
  patch: Partial<typeof integrationProviders.$inferInsert>, db: DrizzleDB,
): Promise<IntegrationRow> {
  const [existing] = await db.select().from(integrationProviders)
    .where(and(
      eq(integrationProviders.tenant_id, tenantId),
      eq(integrationProviders.provider_key, key),
      eq(integrationProviders.environment, environment),
    ));

  if (existing) {
    const [updated] = await db.update(integrationProviders)
      .set(patch)
      .where(eq(integrationProviders.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(integrationProviders)
    .values({ tenant_id: tenantId, provider_key: key, environment, ...patch })
    .returning();
  return created;
}

export async function saveCredentials(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment,
  incoming: Record<string, unknown>, userId: string | null, db: DrizzleDB = _db,
): Promise<IntegrationRow> {
  const [existing] = await db.select().from(integrationProviders)
    .where(and(
      eq(integrationProviders.tenant_id, tenantId),
      eq(integrationProviders.provider_key, key),
      eq(integrationProviders.environment, environment),
    ));

  const credentials = mergeCredentials(
    (existing?.credentials ?? {}) as Record<string, unknown>, incoming, key,
  );
  // Credencial trocada invalida o Ping anterior — deixar o "verde" antigo na
  // tela depois de colar uma chave nova seria mentira.
  return upsert(tenantId, key, environment, {
    credentials: credentials as any, updated_by: userId,
    last_ping_at: null, last_ping_ok: null, last_ping_message: null,
  }, db);
}

/**
 * Liga/desliga o par (provider, ambiente). Ligar um ambiente DESLIGA o outro —
 * o índice parcial uq_integration_providers_enabled só permite um por provider,
 * e a alternativa (erro de constraint na cara do usuário) seria pior UX.
 */
export async function setEnabled(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment,
  enabled: boolean, userId: string | null, db: DrizzleDB = _db,
): Promise<IntegrationRow> {
  if (enabled) {
    await db.update(integrationProviders)
      .set({ enabled: false })
      .where(and(
        eq(integrationProviders.tenant_id, tenantId),
        eq(integrationProviders.provider_key, key),
        ne(integrationProviders.environment, environment),
      ));
  }
  return upsert(tenantId, key, environment, { enabled, updated_by: userId }, db);
}

/**
 * Grava os serviços habilitados. Chave fora do catálogo é DESCARTADA em vez de
 * dar erro: assim uma tela de versão anterior (ou um serviço removido do
 * catálogo) não trava o salvamento do resto.
 *
 * Recebe sempre a lista COMPLETA do que deve ficar ligado — não é um patch
 * incremental. Passar [] desliga tudo; é intencional e possível.
 */
export async function saveServices(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment,
  serviceKeys: string[], userId: string | null, db: DrizzleDB = _db,
): Promise<IntegrationRow> {
  const valid = serviceKeys.filter(k => isServiceKey(key, k));
  return upsert(tenantId, key, environment, {
    enabled_services: [...new Set(valid)], updated_by: userId,
  }, db);
}

export async function savePingResult(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment,
  ok: boolean, message: string | null, db: DrizzleDB = _db,
): Promise<void> {
  await upsert(tenantId, key, environment, {
    last_ping_at: new Date(), last_ping_ok: ok, last_ping_message: message,
  }, db);
}

/** Credenciais para o Ping: as do formulário desta linha, sem cair no ENV. */
export async function credentialsForPing(
  tenantId: string, key: ProviderKey, environment: IntegrationEnvironment, db: DrizzleDB = _db,
): Promise<Record<string, string> | null> {
  const [row] = await db.select().from(integrationProviders)
    .where(and(
      eq(integrationProviders.tenant_id, tenantId),
      eq(integrationProviders.provider_key, key),
      eq(integrationProviders.environment, environment),
    ));
  if (row) {
    const values = rowCredentials(row);
    if (isComplete(key, values)) return values;
    // Linha existe mas incompleta e o ambiente bate com o da plataforma:
    // testar o fallback é o que o usuário espera ver ("está funcionando hoje?").
    if (Object.keys(values).length > 0) return null;
  }
  return platformEnvironment(key) === environment ? platformCredentials(key) : null;
}
