// Testes estruturais do serviceVisitService com db mockado (mesmo padrão de
// schedulingSessionService.test.ts): garantimos a ORDEM das operações
// (advisory lock antes da leitura de bloqueios, conflito atômico dentro da
// transação) e o erro de domínio com payload — a serialização real sob
// concorrência é coberta pelos testes de integração.

import { describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

vi.mock('../lib/notificationsClient', () => ({ sendSystemNotification: vi.fn().mockResolvedValue(undefined) }));

import { scheduleVisit } from '../services/serviceVisitService';
import { ServiceVisitDomainError } from '../domain/serviceVisit/serviceVisitDomain';

const TENANT = 'tenant-1';
const ORDER  = 'order-1';
const TECH   = 'tech-1';

// Sempre bem no futuro — validateServiceVisitCreate rejeita datas passadas
// contra o relógio real (sem `now` injetável nesta camada, regra já
// existente antes desta feature); um horizonte de 1 ano evita virar um teste
// "time bomb" (mesma lição da regra do fiscalCompaniesOverview).
const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

interface MockOpts {
  selectQueue?: any[][];
  insertReturn?: any;
}

function makeDb(opts: MockOpts) {
  const inserts: Array<{ table: string; values: any }> = [];
  const updates: Array<{ table: string; set: any }> = [];
  const calls: string[] = [];
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
      const result = selectQueue.shift() ?? [];
      return chainable(() => result);
    }),
    insert: vi.fn((table: any) => {
      const name = getTableName(table);
      calls.push(`insert:${name}`);
      return chainable(
        () => [opts.insertReturn ?? { id: 'visit-new' }],
        (m, args) => { if (m === 'values') inserts.push({ table: name, values: args[0] }); },
      );
    }),
    update: vi.fn((table: any) => {
      const name = getTableName(table);
      calls.push(`update:${name}`);
      return chainable(
        () => [{ id: 'updated' }],
        (m, args) => { if (m === 'set') updates.push({ table: name, set: args[0] }); },
      );
    }),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/pg_advisory_xact_lock/.test(text)) { calls.push('execute:lock'); }
      else { calls.push('execute:other'); }
      return { rows: [] };
    }),
  };

  return { db, inserts, updates, calls };
}

const ORDER_ROW = { id: ORDER, tenant_id: TENANT, status: 'draft', title: 'Reparo do ar-condicionado' };
const TECH_ROW  = { id: TECH, tenant_id: TENANT, is_active: true, name: 'João Técnico', email: 'joao@tecnico.com' };

describe('scheduleVisit — conflito atômico de horário (regra 78)', () => {
  const args = { tenantId: TENANT, serviceOrderId: ORDER, technicianId: TECH, scheduledAt: FUTURE };

  it('agenda normalmente quando o técnico está livre, com duração default de 60min', async () => {
    const { db, inserts, calls } = makeDb({ selectQueue: [[ORDER_ROW], [TECH_ROW], []] });

    const visit = await scheduleVisit(args, db);

    expect(visit).toMatchObject({ id: 'visit-new' });
    expect(inserts[0].values).toMatchObject({ duration_minutes: 60, status: 'scheduled', technician_id: TECH });
    // Lock vem ANTES da leitura de bloqueadores, dentro da transação.
    expect(calls.indexOf('execute:lock')).toBeLessThan(calls.lastIndexOf('select'));
  });

  it('respeita duration_minutes explícito', async () => {
    const { db, inserts } = makeDb({ selectQueue: [[ORDER_ROW], [TECH_ROW], []] });

    await scheduleVisit({ ...args, durationMinutes: 120 }, db);

    expect(inserts[0].values).toMatchObject({ duration_minutes: 120 });
  });

  it('lança visit_conflict quando o técnico já tem visita scheduled sobreposta', async () => {
    const blocker = {
      id: 'v-existing',
      scheduled_at: new Date(FUTURE.getTime() + 15 * 60_000), // 15min depois do início do candidato
      duration_minutes: 60,
      status: 'scheduled',
    };
    const { db, inserts } = makeDb({ selectQueue: [[ORDER_ROW], [TECH_ROW], [blocker]] });

    await expect(scheduleVisit(args, db)).rejects.toMatchObject({
      code: 'visit_conflict',
      payload: { conflicting: { visit_id: 'v-existing', status: 'scheduled' } },
    });
    expect(inserts).toHaveLength(0); // nunca insere quando há conflito
  });

  it('visita cancelled do mesmo técnico no mesmo horário NÃO conflita (libera o horário)', async () => {
    const blocker = {
      id: 'v-cancelled',
      scheduled_at: FUTURE,
      duration_minutes: 60,
      status: 'cancelled',
    };
    const { db, inserts } = makeDb({ selectQueue: [[ORDER_ROW], [TECH_ROW], [blocker]] });

    await scheduleVisit(args, db);

    expect(inserts).toHaveLength(1);
  });

  it('service_order_not_found quando a OS não existe no tenant', async () => {
    const { db } = makeDb({ selectQueue: [[]] });
    await expect(scheduleVisit(args, db)).rejects.toMatchObject({ code: 'service_order_not_found' });
  });

  it('technician_not_found_or_inactive quando o técnico não existe/está inativo', async () => {
    const { db } = makeDb({ selectQueue: [[ORDER_ROW], []] });
    await expect(scheduleVisit(args, db)).rejects.toMatchObject({ code: 'technician_not_found_or_inactive' });
  });
});
