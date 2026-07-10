// Domínio da Integração com o Google Calendar — puro, sem I/O.
//
// signState/verifyState protegem o callback OAuth contra CSRF sem tabela nova:
// o state carrega o PROFISSIONAL (professional_id) assinado com HMAC-SHA256 +
// timestamp e expira sozinho — mesmo padrão do marketplaceDomain (Mercado Livre).
// sessionToGoogleEvent mapeia uma sessão do agendamento para o corpo de um
// evento da Google Calendar API v3 (mutão ERP→Google).

import { createHmac, timingSafeEqual } from 'crypto';

export class GoogleCalendarDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'GoogleCalendarDomainError';
  }
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutos — tempo de sobra p/ autorizar no Google

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Assina professional_id + timestamp — vira o `state` da URL de autorização. */
export function signState(professionalId: string, secret: string): string {
  const payload = `${professionalId}.${Date.now()}`;
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payload, secret)}`;
}

export interface VerifyStateResult {
  valid: boolean;
  professionalId?: string;
  reason?: 'malformed' | 'tampered' | 'expired';
}

/** Verifica o state do callback — nunca confia no valor sem reassinar. */
export function verifyState(token: string, secret: string, now: number = Date.now()): VerifyStateResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };

  const [payloadB64, receivedSig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const [professionalId, timestampStr] = payload.split('.');
  const timestamp = Number(timestampStr);
  if (!professionalId || !Number.isFinite(timestamp)) return { valid: false, reason: 'malformed' };

  const expectedSig = sign(payload, secret);
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  const receivedBuf = Buffer.from(receivedSig ?? '', 'hex');
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return { valid: false, reason: 'tampered' };
  }

  if (now - timestamp > STATE_MAX_AGE_MS) return { valid: false, reason: 'expired' };

  return { valid: true, professionalId };
}

export interface BuildAuthorizationUrlArgs {
  authUrl: string; // https://accounts.google.com/o/oauth2/v2/auth
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
}

/** Monta a URL de autorização OAuth2 do Google — access_type=offline + consent
 *  para receber refresh_token (Google só o devolve no primeiro consent, por
 *  isso forçamos prompt=consent). */
export function buildAuthorizationUrl(args: BuildAuthorizationUrlArgs): string {
  const url = new URL(args.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('scope', args.scope);
  url.searchParams.set('state', args.state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

// ── Mapeamento sessão → evento do Google Calendar ────────────────────────────

export interface SessionForEvent {
  client_name: string;
  date:        string; // 'YYYY-MM-DD'
  start_time:  string; // 'HH:mm'
  end_time:    string; // 'HH:mm'
  notes:       string | null;
}

export interface GoogleEventBody {
  summary:     string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end:   { dateTime: string; timeZone: string };
}

/**
 * Sessão → corpo de evento da Google Calendar API. Horários são wall-clock do
 * tenant: montamos 'YYYY-MM-DDTHH:mm:00' + timeZone IANA e deixamos o Google
 * resolver o offset (sem lib de datas — mesmo racional do resto do agendamento).
 */
export function sessionToGoogleEvent(session: SessionForEvent, areaName: string | null, tz: string): GoogleEventBody {
  const summary = areaName ? `${session.client_name} — ${areaName}` : session.client_name;
  return {
    summary,
    ...(session.notes ? { description: session.notes } : {}),
    start: { dateTime: `${session.date}T${session.start_time}:00`, timeZone: tz },
    end:   { dateTime: `${session.date}T${session.end_time}:00`,   timeZone: tz },
  };
}
