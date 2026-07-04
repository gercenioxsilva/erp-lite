// Orquestração de I/O para a conexão OAuth do Mercado Livre (regra 42).
// Uma conexão é por EMPRESA (nfe_configs), não por tenant — reaproveita
// companyService.resolveCompanyId para validar posse do tenant sobre a empresa.
//
// Fase 1 (api-core apenas): a troca de code→token acontece via fetch direto ao
// endpoint OAuth do Mercado Livre (chamada síncrona única, não precisa de fila/
// Lambda). Sincronização de preço/estoque e importação de pedido (que SIM
// precisam de fila) ficam em materialMarketplaceLinkService.ts/
// marketplaceWebhookService.ts, ambos já graceful-no-op sem a fila (Fase 2).

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { marketplaceConnections, nfeConfigs } from '../db/schema';
import { signState, verifyState, buildAuthorizationUrl, MarketplaceDomainError } from '../domain/marketplace/marketplaceDomain';
import { resolveCompanyId, CompanyDomainError } from './companyService';

export { MarketplaceDomainError };

// Converte CompanyDomainError para MarketplaceDomainError — mantém uma única
// superfície de erro para quem chama este serviço (rotas só precisam checar
// instanceof MarketplaceDomainError, nunca importar CompanyDomainError também).
async function resolveOwnedCompany(tenantId: string, companyId: string, db: DrizzleDB) {
  try {
    return await resolveCompanyId(tenantId, companyId, db);
  } catch (err) {
    if (err instanceof CompanyDomainError) throw new MarketplaceDomainError('company_not_found', { companyId });
    throw err;
  }
}

export type DrizzleDB = typeof _db;
export type MarketplaceConnection = typeof marketplaceConnections.$inferSelect;

const ML_AUTH_URL  = process.env.MERCADOLIVRE_AUTH_URL  || 'https://auth.mercadolivre.com.br/authorization';
const ML_TOKEN_URL = process.env.MERCADOLIVRE_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token';

function stateSecret(): string {
  return process.env.MARKETPLACE_STATE_SECRET || process.env.JWT_SECRET || 'dev-secret-change-in-production';
}

function clientId(): string {
  return process.env.MERCADOLIVRE_CLIENT_ID || '';
}
function clientSecret(): string {
  return process.env.MERCADOLIVRE_CLIENT_SECRET || '';
}
function redirectUri(): string {
  return process.env.MERCADOLIVRE_REDIRECT_URI
    || `${process.env.APP_URL || 'https://orquestraerp.com.br'}/v1/public/integrations/mercadolivre/callback`;
}

export async function getAuthorizationUrl(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<string> {
  await resolveOwnedCompany(tenantId, companyId, db); // valida posse do tenant sobre a empresa

  if (!clientId()) throw new MarketplaceDomainError('marketplace_not_configured');

  const state = signState(companyId, stateSecret());
  return buildAuthorizationUrl({
    authUrl: ML_AUTH_URL, clientId: clientId(), redirectUri: redirectUri(), state,
  });
}

interface MlTokenResponse {
  access_token: string; token_type: string; expires_in: number;
  scope?: string; user_id?: number; refresh_token?: string;
}

/**
 * Troca o `code` do callback OAuth por tokens. O `state` é a única fonte da
 * empresa (não há JWT nesse redirect público) — por isso é sempre revalidado
 * via HMAC antes de confiar no company_id nele contido (regra 42).
 */
export async function handleOAuthCallback(code: string, state: string, db: DrizzleDB = _db): Promise<MarketplaceConnection> {
  const verified = verifyState(state, stateSecret());
  if (!verified.valid) throw new MarketplaceDomainError('invalid_state', { reason: verified.reason });

  // Único ponto do serviço que busca nfe_configs sem tenantId — company_id já
  // foi validado criptograficamente pelo HMAC acima, então confiar nele aqui é seguro.
  const [company] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, verified.companyId!));
  if (!company || !company.is_active) throw new MarketplaceDomainError('company_not_found');

  if (!clientId() || !clientSecret()) throw new MarketplaceDomainError('marketplace_not_configured');

  const res = await fetch(ML_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri(),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new MarketplaceDomainError('oauth_exchange_failed', { status: res.status, body: errBody });
  }

  const token = await res.json() as MlTokenResponse;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + token.expires_in * 1000);

  const [existing] = await db.select().from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.company_id, company.id), eq(marketplaceConnections.provider, 'mercadolivre')));

  const values = {
    ml_user_id: token.user_id != null ? String(token.user_id) : null,
    access_token: token.access_token,
    refresh_token: token.refresh_token ?? null,
    token_expires_at: expiresAt,
    scope: token.scope ?? null,
    status: 'connected',
    connected_at: now,
    disconnected_at: null,
    last_refreshed_at: now,
  };

  if (existing) {
    const [row] = await db.update(marketplaceConnections).set(values)
      .where(eq(marketplaceConnections.id, existing.id)).returning();
    return row;
  }

  const [row] = await db.insert(marketplaceConnections).values({
    tenant_id: company.tenant_id, company_id: company.id, provider: 'mercadolivre', ...values,
  }).returning();
  return row;
}

/** Todas as conexões do tenant (qualquer empresa) — usado pelo frontend para
 * montar o seletor de "qual loja ML" ao vincular um material. */
export async function listConnections(tenantId: string, db: DrizzleDB = _db): Promise<MarketplaceConnection[]> {
  return db.select().from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.tenant_id, tenantId), eq(marketplaceConnections.provider, 'mercadolivre')));
}

export async function getConnectionStatus(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<MarketplaceConnection | null> {
  await resolveOwnedCompany(tenantId, companyId, db);
  const [row] = await db.select().from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.company_id, companyId), eq(marketplaceConnections.provider, 'mercadolivre')));
  return row ?? null;
}

export async function disconnectConnection(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<void> {
  await resolveOwnedCompany(tenantId, companyId, db);
  const [row] = await db.select().from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.company_id, companyId), eq(marketplaceConnections.provider, 'mercadolivre')));
  if (!row) throw new MarketplaceDomainError('connection_not_found');

  await db.update(marketplaceConnections).set({
    status: 'disconnected', access_token: null, refresh_token: null,
    disconnected_at: new Date(),
  }).where(eq(marketplaceConnections.id, row.id));
}

/** Resolve a conexão a partir do ml_user_id que um webhook traz — usado pela ingestão de webhook. */
export async function findConnectionByMlUserId(mlUserId: string, db: DrizzleDB = _db): Promise<MarketplaceConnection | null> {
  const [row] = await db.select().from(marketplaceConnections).where(eq(marketplaceConnections.ml_user_id, mlUserId));
  return row ?? null;
}
