// Orquestração de I/O da conexão OAuth do Google Calendar (por profissional).
// Fase 1: connect/callback/status/disconnect. A troca code→token é um fetch
// direto ao endpoint OAuth do Google (chamada síncrona única, sem fila). O sync
// de eventos (syncSessionEvent) fica em módulo próprio, disparado fire-and-forget.
//
// Espelho de marketplaceConnectionService: sem axios, sem KMS (tokens em texto
// puro nesta fase), feature-flag por env-unset (sem GOOGLE_CLIENT_ID → connect
// responde erro amigável e o sync é no-op).

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { schedulingCalendarConnections } from '../db/schema';
import {
  signState, verifyState, buildAuthorizationUrl, GoogleCalendarDomainError,
} from '../domain/googleCalendar/googleCalendarDomain';
import { getProfessionalOrThrow } from './schedulingProfessionalService';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

export { GoogleCalendarDomainError };
export type DrizzleDB = typeof _db;
export type CalendarConnection = typeof schedulingCalendarConnections.$inferSelect;

const GOOGLE_AUTH_URL     = process.env.GOOGLE_OAUTH_AUTH_URL  || 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL    = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
// Escopo mínimo para criar/editar/remover eventos na agenda do usuário.
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function stateSecret(): string {
  return process.env.MARKETPLACE_STATE_SECRET || process.env.JWT_SECRET || 'dev-secret-change-in-production';
}
function clientId(): string { return process.env.GOOGLE_CLIENT_ID || ''; }
function clientSecret(): string { return process.env.GOOGLE_CLIENT_SECRET || ''; }
function redirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI
    || `${process.env.APP_URL || 'https://orquestraerp.com.br'}/v1/public/integrations/google/callback`;
}

/** Feature-flag: só está "configurada" quando o app tem as credenciais Google. */
export function isGoogleCalendarConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

// getProfessionalOrThrow lança SchedulingDomainError('professional_not_found');
// convertemos para o erro deste serviço para a rota ter uma superfície única.
async function ensureProfessional(professionalId: string, tenantId: string, db: DrizzleDB) {
  try {
    return await getProfessionalOrThrow(professionalId, tenantId, db);
  } catch (err) {
    if (err instanceof SchedulingDomainError) throw new GoogleCalendarDomainError('professional_not_found', { professionalId });
    throw err;
  }
}

export async function getAuthorizationUrl(tenantId: string, professionalId: string, db: DrizzleDB = _db): Promise<string> {
  await ensureProfessional(professionalId, tenantId, db);
  if (!isGoogleCalendarConfigured()) throw new GoogleCalendarDomainError('google_not_configured');

  const state = signState(professionalId, stateSecret());
  return buildAuthorizationUrl({
    authUrl: GOOGLE_AUTH_URL, clientId: clientId(), redirectUri: redirectUri(), scope: GOOGLE_SCOPE, state,
  });
}

interface GoogleTokenResponse {
  access_token: string; token_type: string; expires_in: number;
  scope?: string; refresh_token?: string;
}

/**
 * Troca o `code` do callback por tokens. O `state` (HMAC) é a única fonte do
 * profissional (não há JWT nesse redirect público) — revalidado antes de confiar.
 */
export async function handleOAuthCallback(code: string, state: string, db: DrizzleDB = _db): Promise<CalendarConnection> {
  const verified = verifyState(state, stateSecret());
  if (!verified.valid) throw new GoogleCalendarDomainError('invalid_state', { reason: verified.reason });
  if (!isGoogleCalendarConfigured()) throw new GoogleCalendarDomainError('google_not_configured');

  const professionalId = verified.professionalId!;
  // O state prova que o professional_id foi assinado por nós; precisamos do
  // tenant_id do profissional para o escopo de gravação da conexão.
  const professional = await loadProfessionalForConnect(professionalId, db);
  if (!professional) throw new GoogleCalendarDomainError('professional_not_found');

  const res = await fetch(GOOGLE_TOKEN_URL, {
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
    throw new GoogleCalendarDomainError('oauth_exchange_failed', { status: res.status, body: errBody });
  }

  const token = await res.json() as GoogleTokenResponse;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + token.expires_in * 1000);
  const email = await fetchGoogleEmail(token.access_token).catch(() => null);

  const [existing] = await db.select().from(schedulingCalendarConnections)
    .where(and(
      eq(schedulingCalendarConnections.professional_id, professionalId),
      eq(schedulingCalendarConnections.provider, 'google'),
    ));

  const values = {
    google_account_email: email,
    access_token: token.access_token,
    // Google só devolve refresh_token no primeiro consent — na reconexão sem
    // ele, preservamos o que já tínhamos (senão perderíamos a capacidade de renovar).
    refresh_token: token.refresh_token ?? existing?.refresh_token ?? null,
    token_expires_at: expiresAt,
    scope: token.scope ?? GOOGLE_SCOPE,
    status: 'connected',
    connected_at: now,
    disconnected_at: null,
    last_refreshed_at: now,
  };

  if (existing) {
    const [row] = await db.update(schedulingCalendarConnections).set(values)
      .where(eq(schedulingCalendarConnections.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(schedulingCalendarConnections).values({
    tenant_id: professional.tenant_id, professional_id: professionalId, provider: 'google', ...values,
  }).returning();
  return row;
}

// Carrega o profissional (para descobrir o tenant_id no callback, que não tem
// JWT). Import tardio evita ciclo com schedulingProfessionalService.
async function loadProfessionalForConnect(professionalId: string, db: DrizzleDB) {
  const { schedulingProfessionals } = await import('../db/schema');
  const [row] = await db.select({ tenant_id: schedulingProfessionals.tenant_id })
    .from(schedulingProfessionals).where(eq(schedulingProfessionals.id, professionalId));
  return row ?? null;
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const info = await res.json() as { email?: string };
  return info.email ?? null;
}

export async function getConnectionStatus(tenantId: string, professionalId: string, db: DrizzleDB = _db): Promise<CalendarConnection | null> {
  await ensureProfessional(professionalId, tenantId, db);
  const [row] = await db.select().from(schedulingCalendarConnections)
    .where(and(
      eq(schedulingCalendarConnections.professional_id, professionalId),
      eq(schedulingCalendarConnections.provider, 'google'),
    ));
  return row ?? null;
}

export async function disconnectConnection(tenantId: string, professionalId: string, db: DrizzleDB = _db): Promise<void> {
  await ensureProfessional(professionalId, tenantId, db);
  const [row] = await db.select().from(schedulingCalendarConnections)
    .where(and(
      eq(schedulingCalendarConnections.professional_id, professionalId),
      eq(schedulingCalendarConnections.provider, 'google'),
    ));
  if (!row) throw new GoogleCalendarDomainError('connection_not_found');

  await db.update(schedulingCalendarConnections).set({
    status: 'disconnected', access_token: null, refresh_token: null,
    disconnected_at: new Date(),
  }).where(eq(schedulingCalendarConnections.id, row.id));
}
