// Domínio puro da integração Google Calendar: state HMAC (CSRF do callback
// OAuth) e o mapeamento sessão → evento (fuso wall-clock do tenant → RFC3339).

import { describe, it, expect } from 'vitest';
import {
  signState, verifyState, buildAuthorizationUrl, sessionToGoogleEvent,
} from '../domain/googleCalendar/googleCalendarDomain';

const SECRET = 'test-secret';
const PROF = 'prof-123';

describe('signState / verifyState', () => {
  it('assina e verifica o professional_id de volta', () => {
    const state = signState(PROF, SECRET);
    const r = verifyState(state, SECRET);
    expect(r.valid).toBe(true);
    expect(r.professionalId).toBe(PROF);
  });

  it('rejeita state adulterado (assinatura não bate)', () => {
    const state = signState(PROF, SECRET);
    const tampered = state.slice(0, -2) + (state.slice(-1) === 'a' ? 'bb' : 'aa');
    const r = verifyState(tampered, SECRET);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('tampered');
  });

  it('rejeita state assinado com outro segredo', () => {
    const state = signState(PROF, SECRET);
    expect(verifyState(state, 'outro-secret').valid).toBe(false);
  });

  it('rejeita state malformado', () => {
    expect(verifyState('lixo', SECRET).reason).toBe('malformed');
    expect(verifyState('a.b.c', SECRET).reason).toBe('malformed');
  });

  it('expira após 10 minutos', () => {
    const state = signState(PROF, SECRET);
    const future = Date.now() + 11 * 60 * 1000;
    const r = verifyState(state, SECRET, future);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });
});

describe('buildAuthorizationUrl', () => {
  it('monta a URL OAuth do Google com offline + consent (p/ refresh_token)', () => {
    const url = new URL(buildAuthorizationUrl({
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      clientId: 'cid', redirectUri: 'https://app/cb',
      scope: 'https://www.googleapis.com/auth/calendar.events', state: 'st',
    }));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('st');
  });
});

describe('sessionToGoogleEvent', () => {
  const session = {
    client_name: 'João', date: '2026-08-17',
    start_time: '09:00', end_time: '10:00', notes: 'Trazer documento',
  };

  it('monta evento com wall-clock + timeZone IANA (Google resolve o offset)', () => {
    const ev = sessionToGoogleEvent(session, 'Corte', 'America/Sao_Paulo');
    expect(ev.summary).toBe('João — Corte');
    expect(ev.description).toBe('Trazer documento');
    expect(ev.start).toEqual({ dateTime: '2026-08-17T09:00:00', timeZone: 'America/Sao_Paulo' });
    expect(ev.end).toEqual({ dateTime: '2026-08-17T10:00:00', timeZone: 'America/Sao_Paulo' });
  });

  it('sem área, o summary é só o nome do cliente', () => {
    const ev = sessionToGoogleEvent(session, null, 'America/Sao_Paulo');
    expect(ev.summary).toBe('João');
  });

  it('sem notes, não inclui description', () => {
    const ev = sessionToGoogleEvent({ ...session, notes: null }, 'Corte', 'America/Sao_Paulo');
    expect(ev.description).toBeUndefined();
  });
});
