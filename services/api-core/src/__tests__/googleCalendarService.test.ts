// Wiring do googleCalendarService com db mockado: gate de feature-flag
// (sem GOOGLE_CLIENT_ID → erro), URL de autorização quando configurado, e
// status/disconnect. A troca OAuth real (fetch ao Google) não é exercida aqui.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAuthorizationUrl, getConnectionStatus, disconnectConnection,
  isGoogleCalendarConfigured, GoogleCalendarDomainError,
} from '../services/googleCalendarService';

const TENANT = 'tenant-1';
const PROF = 'prof-1';

// getProfessionalOrThrow é usado para validar posse; mockamos para achar/não
// achar o profissional sem tocar no banco real.
vi.mock('../services/schedulingProfessionalService', () => ({
  getProfessionalOrThrow: vi.fn(async (id: string) => {
    if (id === PROF) return { id: PROF, tenant_id: TENANT };
    const { SchedulingDomainError } = await import('../domain/scheduling/schedulingDomain');
    throw new SchedulingDomainError('professional_not_found', { id });
  }),
}));

function makeDb(rows: any[] = []) {
  const chain: any = { from: () => chain, where: () => Promise.resolve(rows), set: () => chain, returning: () => Promise.resolve(rows) };
  return {
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    insert: vi.fn(() => chain),
  } as any;
}

const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); return ''; } catch (e) { return (e as GoogleCalendarDomainError).code; }
};

describe('feature-flag (env-unset → inerte)', () => {
  const saved = { ...process.env };
  beforeEach(() => { delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });
  afterEach(() => { process.env = { ...saved }; });

  // 0091: a credencial virou por tenant com fallback de plataforma. O db mock
  // devolve [] (nenhuma config própria), então o resultado ainda é governado
  // pelas envs que este bloco apaga — a semântica do teste segue a mesma.
  it('isGoogleCalendarConfigured é false sem credenciais', async () => {
    expect(await isGoogleCalendarConfigured(TENANT, makeDb())).toBe(false);
  });

  it('getAuthorizationUrl lança google_not_configured sem credenciais', async () => {
    expect(await code(() => getAuthorizationUrl(TENANT, PROF, makeDb()))).toBe('google_not_configured');
  });
});

describe('getAuthorizationUrl (configurado)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.APP_URL = 'https://app.local';
  });
  afterEach(() => { process.env = { ...saved }; });

  it('devolve URL OAuth do Google com scope de eventos', async () => {
    const url = new URL(await getAuthorizationUrl(TENANT, PROF, makeDb()));
    expect(url.origin + url.pathname).toContain('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('profissional de outro tenant → professional_not_found', async () => {
    expect(await code(() => getAuthorizationUrl(TENANT, 'prof-alheio', makeDb()))).toBe('professional_not_found');
  });
});

describe('status / disconnect', () => {
  it('status devolve null quando não há conexão', async () => {
    expect(await getConnectionStatus(TENANT, PROF, makeDb([]))).toBeNull();
  });

  it('status devolve a conexão quando existe', async () => {
    const conn = { id: 'c1', status: 'connected', google_account_email: 'a@b.com', access_token: 'tok' };
    expect(await getConnectionStatus(TENANT, PROF, makeDb([conn]))).toMatchObject({ status: 'connected' });
  });

  it('disconnect sem conexão → connection_not_found', async () => {
    expect(await code(() => disconnectConnection(TENANT, PROF, makeDb([])))).toBe('connection_not_found');
  });
});
