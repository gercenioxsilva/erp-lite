// Testes estruturais do sessionService com db mockado (padrão de
// costCenterStock.test.ts): a serialização real é coberta pelos testes de
// integração; aqui garantimos a ORDEM das operações (advisory lock antes da
// leitura de bloqueios; FOR UPDATE da sessão antes do pacote), o débito
// atômico dentro de UMA transação e os erros de domínio com payload.

import { describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  createSession, approveSession, completeSession, requestSessionAsClient,
} from '../services/schedulingSessionService';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

const TENANT = 'tenant-1';
const PROF = 'prof-1';
const AREA = 'area-carro';
const OTHER_AREA = 'area-moto';
const CLIENT = 'client-1';

interface MockOpts {
  selectQueue?: any[][];
  sessionRow?: any;
  packageRow?: any;
  insertReturn?: any[];
  updateReturn?: any[];
}

function makeDb(opts: MockOpts) {
  const calls: string[] = [];
  const inserts: Array<{ table: string; values: any }> = [];
  const updates: Array<{ table: string; set: any }> = [];
  const selectQueue = [...(opts.selectQueue ?? [])];

  const chainable = (provider: () => any, capture?: (method: string, args: any[]) => void) => {
    const obj: any = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'set', 'values', 'returning']) {
      obj[m] = (...args: any[]) => { capture?.(m, args); return obj; };
    }
    obj.then = (res: any, rej: any) => Promise.resolve().then(provider).then(res, rej);
    return obj;
  };

  const db: any = {
    transaction: vi.fn(async (cb: any) => cb(db)),
    select: vi.fn(() => {
      calls.push('select');
      // A fila é consumida NA CHAMADA de select() (ordem síncrona de
      // construção das queries), não no await — senão o Promise.all do
      // getAvailableSlots embaralharia a ordem via microtasks.
      const result = selectQueue.shift() ?? [];
      return chainable(() => result);
    }),
    insert: vi.fn((table: any) => {
      const name = getTableName(table);
      calls.push(`insert:${name}`);
      return chainable(
        () => opts.insertReturn ?? [{ id: 'new-row' }],
        (m, args) => { if (m === 'values') inserts.push({ table: name, values: args[0] }); },
      );
    }),
    update: vi.fn((table: any) => {
      const name = getTableName(table);
      calls.push(`update:${name}`);
      return chainable(
        () => opts.updateReturn ?? [{ id: 'updated-row' }],
        (m, args) => { if (m === 'set') updates.push({ table: name, set: args[0] }); },
      );
    }),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/pg_advisory_xact_lock/.test(text)) {
        calls.push('execute:lock');
        return { rows: [] };
      }
      if (/scheduling_sessions/.test(text) && /FOR UPDATE/.test(text)) {
        calls.push('execute:session_for_update');
        return { rows: opts.sessionRow ? [opts.sessionRow] : [] };
      }
      if (/scheduling_client_packages/.test(text) && /FOR UPDATE/.test(text)) {
        calls.push('execute:package_for_update');
        return { rows: opts.packageRow ? [opts.packageRow] : [] };
      }
      calls.push('execute:other');
      return { rows: [] };
    }),
  };

  return { db, calls, inserts, updates };
}

const code = async (fn: () => Promise<unknown>): Promise<string> => {
  try { await fn(); return ''; } catch (e) { return (e as SchedulingDomainError).code; }
};

// Filas de select para createSession (pré-transação):
// area → prof → vínculo prof↔área → nome do cliente → [tx] bloqueios do dia
const AREA_ROW = { id: AREA, is_active: true, default_duration_minutes: 60 };
const PROF_ROW = { id: PROF, is_active: true };
const LINK_ROW = { id: 'link-1' };
const CLIENT_NAME_ROW = { name: 'João' };

describe('createSession — conflito atômico', () => {
  const args = {
    tenantId: TENANT, professionalId: PROF, clientId: CLIENT,
    areaId: AREA, date: '2026-07-20', startTime: '09:00',
  };

  it('conflito na mesma faixa cita cliente e horário conflitantes no payload', async () => {
    const blocker = {
      id: 's1', area_id: AREA, client_name: 'Maria',
      start_time: '09:30', end_time: '10:30', status: 'confirmed',
    };
    const { db } = makeDb({
      selectQueue: [[AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW], [blocker]],
    });

    try {
      await createSession(args, db);
      expect.unreachable('deveria ter lançado session_conflict');
    } catch (e) {
      const err = e as SchedulingDomainError;
      expect(err.code).toBe('session_conflict');
      expect(err.payload?.conflicting).toMatchObject({
        client_name: 'Maria', start_time: '09:30', end_time: '10:30',
      });
    }
  });

  it('faixa diferente do mesmo profissional não bloqueia (carro×moto)', async () => {
    const blocker = {
      id: 's1', area_id: OTHER_AREA, client_name: 'Maria',
      start_time: '09:00', end_time: '10:00', status: 'confirmed',
    };
    const { db, inserts } = makeDb({
      selectQueue: [[AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW], [blocker]],
      insertReturn: [{ id: 'sess-new' }],
    });

    await createSession(args, db);
    expect(inserts[0].table).toBe('scheduling_sessions');
    expect(inserts[0].values).toMatchObject({
      status: 'confirmed', requested_by: 'professional',
      start_time: '09:00', end_time: '10:00', // fim derivado da duração (60min)
      client_name: 'João',
    });
  });

  it('o advisory lock precede a leitura de bloqueios, tudo na transação', async () => {
    const { db, calls } = makeDb({
      selectQueue: [[AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW], []],
    });
    await createSession(args, db);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    const lockIdx = calls.indexOf('execute:lock');
    const insertIdx = calls.findIndex(c => c === 'insert:scheduling_sessions');
    const blockersIdx = calls.lastIndexOf('select');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(blockersIdx);   // lock antes de olhar a agenda
    expect(blockersIdx).toBeLessThan(insertIdx); // checagem antes de gravar
  });

  it('profissional que não atende a área é rejeitado', async () => {
    const { db } = makeDb({
      selectQueue: [[AREA_ROW], [PROF_ROW], [/* sem vínculo */], [CLIENT_NAME_ROW]],
    });
    expect(await code(() => createSession(args, db))).toBe('professional_area_mismatch');
  });
});

describe('approveSession — aprovação re-checa conflito', () => {
  const pendingRow = {
    id: 'sess-1', tenant_id: TENANT, professional_id: PROF, area_id: AREA,
    date: '2026-07-20', start_time: '09:00', end_time: '10:00', status: 'pending',
  };

  it('conflito surgido depois do pedido derruba a aprovação', async () => {
    const blocker = {
      id: 's2', area_id: AREA, client_name: 'Maria',
      start_time: '09:00', end_time: '10:00', status: 'confirmed',
    };
    const { db } = makeDb({ sessionRow: pendingRow, selectQueue: [[blocker]] });
    expect(await code(() => approveSession('sess-1', TENANT, db))).toBe('session_conflict');
  });

  it('a própria sessão pendente não conflita consigo mesma', async () => {
    const self = {
      id: 'sess-1', area_id: AREA, client_name: 'João',
      start_time: '09:00', end_time: '10:00', status: 'pending',
    };
    const { db, updates } = makeDb({ sessionRow: pendingRow, selectQueue: [[self]] });
    await approveSession('sess-1', TENANT, db);
    expect(updates[0]).toMatchObject({ table: 'scheduling_sessions', set: { status: 'confirmed' } });
  });

  it('só pending aprova', async () => {
    const { db } = makeDb({ sessionRow: { ...pendingRow, status: 'confirmed' } });
    expect(await code(() => approveSession('sess-1', TENANT, db))).toBe('session_not_pending');
  });
});

describe('completeSession — conclusão + débito na MESMA transação', () => {
  const confirmedRow = {
    id: 'sess-1', tenant_id: TENANT, professional_id: PROF, area_id: AREA,
    date: '2026-07-20', start_time: '09:00', end_time: '10:00',
    status: 'confirmed', package_id: 'pkg-1',
  };

  it('ordem de locks fixa (sessão → pacote), débito de 1 e movimento imutável', async () => {
    const { db, calls, inserts, updates } = makeDb({
      sessionRow: confirmedRow,
      packageRow: { id: 'pkg-1', total_sessions: 10, used_sessions: 9 },
    });

    await completeSession('sess-1', TENANT, 'user-1', db);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    const seq = calls.filter(c =>
      c.startsWith('execute:session') || c.startsWith('execute:package') ||
      c.startsWith('update:') || c.startsWith('insert:'));
    expect(seq).toEqual([
      'execute:session_for_update',
      'execute:package_for_update',
      'update:scheduling_client_packages',
      'insert:scheduling_package_movements',
      'update:scheduling_sessions',
    ]);

    // saldo 10/9 → débito deixa 10/10 e o pacote vira exhausted
    expect(updates[0].set).toMatchObject({ used_sessions: 10, status: 'exhausted' });
    expect(inserts[0].values).toMatchObject({
      direction: 'debit', quantity: 1, balance_after: 0,
      reason: 'session_completed', idempotency_key: 'session_completed:sess-1',
    });
    expect(updates[1].set).toMatchObject({ status: 'completed' });
  });

  it('conclusão dupla morre no estado (segunda vê completed sob FOR UPDATE)', async () => {
    const { db } = makeDb({ sessionRow: { ...confirmedRow, status: 'completed' } });
    expect(await code(() => completeSession('sess-1', TENANT, 'user-1', db)))
      .toBe('session_not_completable');
  });

  it('pacote sem saldo falha e nada é gravado', async () => {
    const { db, inserts, updates } = makeDb({
      sessionRow: confirmedRow,
      packageRow: { id: 'pkg-1', total_sessions: 10, used_sessions: 10 },
    });
    expect(await code(() => completeSession('sess-1', TENANT, 'user-1', db)))
      .toBe('package_no_balance');
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('sessão sem pacote conclui sem tocar em saldo algum', async () => {
    const { db, calls, updates } = makeDb({
      sessionRow: { ...confirmedRow, package_id: null },
    });
    await completeSession('sess-1', TENANT, 'user-1', db);
    expect(calls).not.toContain('execute:package_for_update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: 'scheduling_sessions', set: { status: 'completed' } });
  });
});

describe('requestSessionAsClient — revalidação total no backend (regra nº 9)', () => {
  const args = {
    tenantId: TENANT, clientId: CLIENT, clientUserId: 'user-c',
    professionalId: PROF, areaId: AREA, date: '2026-07-20', startTime: '09:00',
  };
  const SETTINGS = {
    tenant_id: TENANT, allow_self_booking: true, min_advance_hours: 12,
    cancel_window_hours: 0, timezone: 'America/Sao_Paulo', onboarding_complete: true,
  };

  it('auto-agendamento desabilitado é rejeitado antes de qualquer coisa', async () => {
    const { db } = makeDb({ selectQueue: [[{ ...SETTINGS, allow_self_booking: false }]] });
    expect(await code(() => requestSessionAsClient(args, db))).toBe('self_booking_disabled');
  });

  it('pedido aquém da antecedência mínima é rejeitado', async () => {
    const { db } = makeDb({
      selectQueue: [[SETTINGS], [AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW]],
    });
    // now: 2026-07-20 09:00Z = 06:00 SP; +12h ⇒ mínimo 18:00 SP; pedido 09:00 viola
    expect(await code(() => requestSessionAsClient(args, db, new Date('2026-07-20T09:00:00Z'))))
      .toBe('min_advance_violation');
  });

  it('grade vazia ⇒ slot_unavailable (nunca "tudo livre")', async () => {
    const { db } = makeDb({
      selectQueue: [
        [SETTINGS], [AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW],
        // getAvailableSlots: área, prof, [rules, exceções, bloqueios, settings]
        [AREA_ROW], [PROF_ROW], [], [], [], [SETTINGS],
      ],
    });
    // now bem antes da data ⇒ antecedência não interfere; grade vazia decide
    expect(await code(() => requestSessionAsClient(args, db, new Date('2026-07-01T09:00:00Z'))))
      .toBe('slot_unavailable');
  });

  it('slot válido nasce pending, segura horário e registra requested_by=client', async () => {
    const { db, inserts } = makeDb({
      selectQueue: [
        [SETTINGS], [AREA_ROW], [PROF_ROW], [LINK_ROW], [CLIENT_NAME_ROW],
        [AREA_ROW], [PROF_ROW],
        [{ weekday: 1, start_time: '08:00', end_time: '12:00' }], // rules (2026-07-20 = segunda)
        [], // exceções
        [], // bloqueios (slots)
        [SETTINGS],
        [], // bloqueios (transação)
      ],
      insertReturn: [{ id: 'sess-new', status: 'pending' }],
    });

    await requestSessionAsClient(args, db, new Date('2026-07-01T09:00:00Z'));
    expect(inserts[0].table).toBe('scheduling_sessions');
    expect(inserts[0].values).toMatchObject({
      status: 'pending', requested_by: 'client',
      start_time: '09:00', end_time: '10:00', created_by: 'user-c',
    });
  });
});
