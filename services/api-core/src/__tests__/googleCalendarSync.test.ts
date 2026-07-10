// syncSessionEvent com db + fetch mockados: no-op sem conexão, cria evento
// (grava google_event_id) no upsert, e deleta no delete. Nenhuma chamada real
// ao Google — vi.stubGlobal('fetch').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { syncSessionEvent } from '../services/googleCalendarService';

const SESSION_ID = 'sess-1';
const PROF = 'prof-1';

const SESSION_ROW = {
  id: SESSION_ID, tenant_id: 'tenant-1', professional_id: PROF,
  client_name: 'João', area_id: 'area-1', date: '2026-08-17',
  start_time: '09:00', end_time: '10:00', notes: null, google_event_id: null as string | null,
};
const CONN_CONNECTED = {
  id: 'c1', professional_id: PROF, provider: 'google', status: 'connected',
  access_token: 'valid-token', refresh_token: 'r', calendar_id: 'primary',
  token_expires_at: new Date(Date.now() + 3_600_000), // válido por 1h
};

// db mock: cada db.select() consome a próxima linha esperada da fila, na ordem
// em que syncSessionEvent consulta (session → connection → area → settings).
function makeDb(queue: any[][]) {
  const q = [...queue];
  const updates: Array<{ set: any }> = [];
  const chain = () => {
    const obj: any = {};
    obj.from = () => obj;
    obj.where = () => Promise.resolve(q.shift() ?? []);
    return obj;
  };
  const db: any = {
    select: vi.fn(() => chain()),
    update: vi.fn(() => ({ set: (v: any) => { updates.push({ set: v }); return { where: () => Promise.resolve() }; } })),
  };
  return { db, updates };
}

describe('syncSessionEvent', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
  });
  afterEach(() => { process.env = { ...saved }; vi.unstubAllGlobals(); });

  it('no-op quando não há conexão (nenhum fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db, updates } = makeDb([[SESSION_ROW], []]); // sessão existe, sem conexão
    await syncSessionEvent(SESSION_ID, 'upsert', db);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('no-op quando a integração não está configurada (env-unset)', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db } = makeDb([]);
    await syncSessionEvent(SESSION_ID, 'upsert', db);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('upsert cria o evento e grava google_event_id', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'gcal-evt-1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { db, updates } = makeDb([
      [SESSION_ROW],                      // session
      [CONN_CONNECTED],                   // connection
      [{ name: 'Corte' }],                // area
      [{ timezone: 'America/Sao_Paulo' }],// settings
    ]);
    await syncSessionEvent(SESSION_ID, 'upsert', db);

    // POST no endpoint de events (token válido → sem refresh)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('/calendars/primary/events');
    expect(opts.method).toBe('POST');
    // grava o id do evento na sessão
    expect(updates.at(-1)?.set).toMatchObject({ google_event_id: 'gcal-evt-1' });
  });

  it('delete remove o evento e limpa google_event_id (quando havia evento)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { db, updates } = makeDb([
      [{ ...SESSION_ROW, google_event_id: 'gcal-evt-1' }],
      [CONN_CONNECTED],
    ]);
    await syncSessionEvent(SESSION_ID, 'delete', db);

    const [url, opts] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('/events/gcal-evt-1');
    expect(opts.method).toBe('DELETE');
    expect(updates.at(-1)?.set).toMatchObject({ google_event_id: null });
  });

  it('delete é no-op quando a sessão não tinha evento', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db } = makeDb([[SESSION_ROW], [CONN_CONNECTED]]); // google_event_id null
    await syncSessionEvent(SESSION_ID, 'delete', db);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
