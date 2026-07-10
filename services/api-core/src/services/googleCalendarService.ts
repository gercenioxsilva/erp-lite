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
import {
  schedulingCalendarConnections, schedulingSessions, schedulingAreas, schedulingSettings,
} from '../db/schema';
import {
  signState, verifyState, buildAuthorizationUrl, sessionToGoogleEvent, GoogleCalendarDomainError,
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

// ── Renovação de token + sincronização de evento (mutão ERP→Google) ──────────

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * Garante um access_token válido: se expirou (ou está perto), troca o
 * refresh_token por um novo. Persiste o resultado. Devolve o access_token
 * utilizável, ou null se não há como renovar (sem refresh_token).
 */
export async function refreshIfExpired(conn: CalendarConnection, db: DrizzleDB = _db): Promise<string | null> {
  const now = Date.now();
  const exp = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  // Margem de 60s para não usar um token que expira no meio da chamada.
  if (conn.access_token && exp - now > 60_000) return conn.access_token;
  if (!conn.refresh_token || !isGoogleCalendarConfigured()) return conn.access_token ?? null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) return null; // renovação falhou — deixa o sync degradar para no-op

  const token = await res.json() as GoogleTokenResponse;
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  await db.update(schedulingCalendarConnections).set({
    access_token: token.access_token, token_expires_at: expiresAt, last_refreshed_at: new Date(),
  }).where(eq(schedulingCalendarConnections.id, conn.id));
  return token.access_token;
}

export type SyncAction = 'upsert' | 'delete';

/**
 * Sincroniza UMA sessão com o Google Calendar do profissional dela.
 * Fire-and-forget: chamada após a transação da rota, com .catch() — nunca
 * derruba o fluxo principal. No-op silencioso quando não há conexão ativa
 * (feature-flag por ausência de conexão, além do env-unset).
 *
 * 'upsert'  → cria (grava google_event_id) ou atualiza o evento.
 * 'delete'  → remove o evento (se houver) e limpa google_event_id.
 */
export async function syncSessionEvent(sessionId: string, action: SyncAction, db: DrizzleDB = _db): Promise<void> {
  if (!isGoogleCalendarConfigured()) return;

  const [session] = await db.select().from(schedulingSessions).where(eq(schedulingSessions.id, sessionId));
  if (!session) return;

  const [conn] = await db.select().from(schedulingCalendarConnections)
    .where(and(
      eq(schedulingCalendarConnections.professional_id, session.professional_id),
      eq(schedulingCalendarConnections.provider, 'google'),
    ));
  if (!conn || conn.status !== 'connected') return;

  const accessToken = await refreshIfExpired(conn, db);
  if (!accessToken) return;

  const calId = encodeURIComponent(conn.calendar_id || 'primary');
  const base = `${GOOGLE_CALENDAR_API}/${calId}/events`;
  const authHeaders = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  if (action === 'delete') {
    if (!session.google_event_id) return; // nada a remover
    await fetch(`${base}/${encodeURIComponent(session.google_event_id)}`, { method: 'DELETE', headers: authHeaders })
      .catch(() => undefined);
    await db.update(schedulingSessions).set({ google_event_id: null }).where(eq(schedulingSessions.id, sessionId));
    return;
  }

  // upsert — precisa do nome da área e do fuso do tenant para montar o evento.
  const [area] = session.area_id
    ? await db.select({ name: schedulingAreas.name }).from(schedulingAreas).where(eq(schedulingAreas.id, session.area_id))
    : [];
  const [settings] = await db.select({ timezone: schedulingSettings.timezone }).from(schedulingSettings)
    .where(eq(schedulingSettings.tenant_id, session.tenant_id));
  const tz = settings?.timezone || 'America/Sao_Paulo';

  const body = JSON.stringify(sessionToGoogleEvent({
    client_name: session.client_name,
    date:        session.date,
    start_time:  session.start_time,
    end_time:    session.end_time,
    notes:       session.notes,
  }, area?.name ?? null, tz));

  if (session.google_event_id) {
    // PATCH do evento existente; se sumiu (404), recria abaixo.
    const res = await fetch(`${base}/${encodeURIComponent(session.google_event_id)}`, { method: 'PATCH', headers: authHeaders, body })
      .catch(() => null);
    if (res && res.ok) return;
    if (res && res.status !== 404) return; // erro transitório — não recria às cegas
  }

  const res = await fetch(base, { method: 'POST', headers: authHeaders, body }).catch(() => null);
  if (!res || !res.ok) return;
  const created = await res.json() as { id?: string };
  if (created.id) {
    await db.update(schedulingSessions).set({ google_event_id: created.id }).where(eq(schedulingSessions.id, sessionId));
  }
}
