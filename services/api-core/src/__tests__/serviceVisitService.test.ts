// Testes estruturais do serviceVisitService com db mockado (mesmo padrão de
// schedulingSessionService.test.ts): garantimos a ORDEM das operações
// (advisory lock antes da leitura de bloqueios, conflito atômico dentro da
// transação) e o erro de domínio com payload — a serialização real sob
// concorrência é coberta pelos testes de integração.

import { describe, it, expect, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

vi.mock('../lib/notificationsClient', () => ({ sendSystemNotification: vi.fn().mockResolvedValue(undefined) }));

import {
  scheduleVisit, rescheduleVisit, cancelVisit, completeVisit, getVisitForTechnician,
} from '../services/serviceVisitService';
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

  const deletes: Array<{ table: string }> = [];

  const chainable = (provider: () => any, capture?: (method: string, args: any[]) => void) => {
    const obj: any = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'leftJoin', 'innerJoin', 'set', 'values', 'returning']) {
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
    delete: vi.fn((table: any) => {
      const name = getTableName(table);
      calls.push(`delete:${name}`);
      deletes.push({ table: name });
      return chainable(() => undefined);
    }),
    execute: vi.fn(async (query: any) => {
      const text = JSON.stringify(query?.queryChunks ?? query ?? '');
      if (/pg_advisory_xact_lock/.test(text)) { calls.push('execute:lock'); }
      else { calls.push('execute:other'); }
      return { rows: [] };
    }),
  };

  return { db, inserts, updates, deletes, calls };
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

// ── Campos personalizados de Visita Técnica (migration 0088) ────────────────

const TECHNICIAN_USER_ROW = { id: TECH, tenant_id: TENANT, user_id: 'user-1', name: 'João Técnico', cpf: '11144477735' };
const VISIT_IN_PROGRESS = {
  id: 'visit-1', tenant_id: TENANT, technician_id: TECH, service_order_id: ORDER,
  status: 'in_progress', checked_in_at: new Date(), scheduled_at: FUTURE, duration_minutes: 60,
};
const FIELD_DEF_REQUIRED = {
  id: 'def-1', tenant_id: TENANT, field_key: 'tem_internet_no_local', label: 'Tem internet no local?',
  field_type: 'boolean', required: true,
};

describe('completeVisit — campos personalizados de visita (migration 0088)', () => {
  const args = { visitId: 'visit-1', technicianUserId: 'user-1', tenantId: TENANT };

  it('completa normalmente sem customFields — comportamento anterior à feature preservado', async () => {
    const { db, updates, calls } = makeDb({
      selectQueue: [[TECHNICIAN_USER_ROW], [VISIT_IN_PROGRESS], [{ status: 'completed' }]],
    });

    await completeVisit(args, db);

    expect(updates.some(u => u.table === 'service_visits' && u.set.status === 'completed')).toBe(true);
    expect(calls.some(c => c.startsWith('delete:'))).toBe(false); // nunca toca campos personalizados sem customFields
  });

  it('valida e persiste os campos ANTES de marcar a visita como completed', async () => {
    const { db, inserts, updates, calls } = makeDb({
      selectQueue: [[TECHNICIAN_USER_ROW], [VISIT_IN_PROGRESS], [FIELD_DEF_REQUIRED], [{ status: 'completed' }]],
    });

    await completeVisit({ ...args, customFields: [{ field_definition_id: 'def-1', value: 'true' }] }, db);

    expect(inserts.some(i => i.table === 'service_visit_field_values' && i.values[0]?.value === 'true')).toBe(true);
    expect(updates.some(u => u.table === 'service_visits' && u.set.status === 'completed')).toBe(true);
    const fieldWriteIdx = calls.indexOf('delete:service_visit_field_values');
    const statusUpdateIdx = calls.indexOf('update:service_visits');
    expect(fieldWriteIdx).toBeGreaterThanOrEqual(0);
    expect(fieldWriteIdx).toBeLessThan(statusUpdateIdx);
  });

  it('campo obrigatório sem resposta bloqueia a conclusão — visita nunca fica "completed"', async () => {
    const { db, updates } = makeDb({
      selectQueue: [[TECHNICIAN_USER_ROW], [VISIT_IN_PROGRESS], [FIELD_DEF_REQUIRED]],
    });

    await expect(completeVisit({ ...args, customFields: [{ field_definition_id: 'def-1', value: '' }] }, db))
      .rejects.toMatchObject({ code: 'field_value_required' });

    expect(updates).toHaveLength(0); // status da visita nunca é tocado
  });
});

describe('getVisitForTechnician — formulário técnico dinâmico (migration 0088)', () => {
  it('devolve fieldDefinitions (schema ativo do tenant) e fieldValues (já respondidos nesta visita)', async () => {
    const orderRow = { id: ORDER, tenant_id: TENANT, client_id: 'client-1', title: 'Reparo' };
    const clientRow = { id: 'client-1', company_name: 'ACME' };
    const fieldValueRow = {
      field_definition_id: 'def-1', field_key: 'tem_internet_no_local', label: 'Tem internet no local?',
      field_type: 'boolean', required: true, value: 'true',
    };
    const { db } = makeDb({
      selectQueue: [
        [TECHNICIAN_USER_ROW], [VISIT_IN_PROGRESS], [orderRow], [clientRow],
        [FIELD_DEF_REQUIRED], [fieldValueRow],
      ],
    });

    const result = await getVisitForTechnician('visit-1', 'user-1', TENANT, db);

    expect(result.fieldDefinitions).toEqual([FIELD_DEF_REQUIRED]);
    expect(result.fieldValues).toEqual([fieldValueRow]);
  });
});

// ── Reagendamento e cancelamento (lado do backoffice, Agenda do Técnico) ────

const VISIT_SCHEDULED = {
  id: 'visit-2', tenant_id: TENANT, technician_id: TECH, service_order_id: ORDER,
  status: 'scheduled', scheduled_at: FUTURE, duration_minutes: 60,
};

describe('rescheduleVisit — muda data/hora com checagem atômica de conflito', () => {
  const NEW_TIME = new Date(FUTURE.getTime() + 24 * 60 * 60 * 1000);

  it('reagenda normalmente quando o novo horário está livre', async () => {
    const { db, updates } = makeDb({ selectQueue: [[VISIT_SCHEDULED], [TECH_ROW], []] });

    await rescheduleVisit({ visitId: 'visit-2', tenantId: TENANT, scheduledAt: NEW_TIME }, db);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: 'service_visits' });
    expect(updates[0].set.scheduled_at.getTime()).toBe(NEW_TIME.getTime());
    expect(updates[0].set.duration_minutes).toBe(60); // mantém a duração atual quando não informada
  });

  it('exclui a própria visita da checagem — nunca "conflita consigo mesma"', async () => {
    // O único bloqueador na agenda é a PRÓPRIA visita sendo reagendada.
    const selfAsBlocker = { id: 'visit-2', scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled' };
    const { db, updates } = makeDb({ selectQueue: [[VISIT_SCHEDULED], [TECH_ROW], [selfAsBlocker]] });

    await rescheduleVisit({ visitId: 'visit-2', tenantId: TENANT, scheduledAt: NEW_TIME }, db);

    expect(updates).toHaveLength(1); // não lançou visit_conflict
  });

  it('lança visit_conflict quando o novo horário colide com OUTRA visita do técnico', async () => {
    const otherBlocker = { id: 'visit-other', scheduled_at: NEW_TIME, duration_minutes: 60, status: 'scheduled' };
    const { db, updates } = makeDb({ selectQueue: [[VISIT_SCHEDULED], [TECH_ROW], [otherBlocker]] });

    await expect(rescheduleVisit({ visitId: 'visit-2', tenantId: TENANT, scheduledAt: NEW_TIME }, db))
      .rejects.toMatchObject({ code: 'visit_conflict', payload: { conflicting: { visit_id: 'visit-other' } } });
    expect(updates).toHaveLength(0);
  });

  it('visit_not_found quando a visita não existe no tenant', async () => {
    const { db } = makeDb({ selectQueue: [[]] });
    await expect(rescheduleVisit({ visitId: 'visit-x', tenantId: TENANT, scheduledAt: NEW_TIME }, db))
      .rejects.toMatchObject({ code: 'visit_not_found' });
  });

  it('visit_cannot_reschedule quando a visita não está mais scheduled (ex.: já em andamento)', async () => {
    const { db } = makeDb({ selectQueue: [[VISIT_IN_PROGRESS]] });
    await expect(rescheduleVisit({ visitId: 'visit-1', tenantId: TENANT, scheduledAt: NEW_TIME }, db))
      .rejects.toMatchObject({ code: 'visit_cannot_reschedule' });
  });
});

describe('cancelVisit — libera o horário do técnico, nunca mexe no status da OS', () => {
  it('cancela normalmente quando scheduled', async () => {
    const { db, updates } = makeDb({ selectQueue: [[VISIT_SCHEDULED]] });
    await cancelVisit({ visitId: 'visit-2', tenantId: TENANT }, db);
    expect(updates).toEqual([{ table: 'service_visits', set: expect.objectContaining({ status: 'cancelled' }) }]);
  });

  it('cancela normalmente quando in_progress', async () => {
    const { db, updates } = makeDb({ selectQueue: [[VISIT_IN_PROGRESS]] });
    await cancelVisit({ visitId: 'visit-1', tenantId: TENANT }, db);
    expect(updates[0].set.status).toBe('cancelled');
  });

  it('visit_not_found quando a visita não existe no tenant', async () => {
    const { db } = makeDb({ selectQueue: [[]] });
    await expect(cancelVisit({ visitId: 'visit-x', tenantId: TENANT }, db))
      .rejects.toMatchObject({ code: 'visit_not_found' });
  });

  it('visit_cannot_cancel quando a visita já está num estado terminal (completed)', async () => {
    const completedVisit = { ...VISIT_IN_PROGRESS, id: 'visit-3', status: 'completed' };
    const { db, updates } = makeDb({ selectQueue: [[completedVisit]] });
    await expect(cancelVisit({ visitId: 'visit-3', tenantId: TENANT }, db))
      .rejects.toMatchObject({ code: 'visit_cannot_cancel' });
    expect(updates).toHaveLength(0);
  });
});
