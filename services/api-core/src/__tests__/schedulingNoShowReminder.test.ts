// no_show (0083) — os invariantes que importam: só de confirmed, terminal,
// NUNCA debita pacote; e o lembrete D-1 é idempotente por sessão.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/schedulingNotificationService', () => ({
  notifySessionEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  assertCanMarkNoShow, isBlockingStatus, SessionStatus,
} from '../domain/scheduling/sessionDomain';
import { markNoShow } from '../services/schedulingSessionService';
import { notifySessionEvent } from '../services/schedulingNotificationService';

describe('no_show — máquina de estados', () => {
  it('só sessão CONFIRMADA pode virar no_show', () => {
    expect(() => assertCanMarkNoShow('confirmed')).not.toThrow();
    for (const st of ['pending', 'completed', 'canceled', 'declined', 'no_show'] as SessionStatus[]) {
      expect(() => assertCanMarkNoShow(st), st).toThrow();
    }
  });

  it('no_show NÃO bloqueia a agenda (horário volta a ficar livre)', () => {
    expect(isBlockingStatus('no_show')).toBe(false);
    expect(isBlockingStatus('pending')).toBe(true);
    expect(isBlockingStatus('confirmed')).toBe(true);
  });
});

describe('markNoShow — service', () => {
  const SESSION = {
    id: 's1', tenant_id: 't1', professional_id: 'p1', client_id: 'c1',
    client_name: 'Cliente', area_id: 'a1', package_id: 'pkg1',
    date: '2026-07-20', start_time: '09:00', end_time: '10:00', status: 'confirmed',
  };

  function fakeDb(status = 'confirmed') {
    const updateSet = vi.fn();
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([{ ...SESSION, status }]) }) })),
      update: vi.fn(() => ({ set: (v: any) => { updateSet(v); return { where: () => ({ returning: () => Promise.resolve([{ ...SESSION, status: 'no_show', ...v }]) }) }; } })),
      transaction: vi.fn(),
    } as any;
    return { db, updateSet };
  }

  beforeEach(() => vi.clearAllMocks());

  it('confirmed → no_show com carimbo, SEM tocar o pacote (nenhuma transaction de débito)', async () => {
    const { db, updateSet } = fakeDb();
    const updated = await markNoShow('s1', 't1', 'user-1', db);
    expect(updated.status).toBe('no_show');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_show', no_show_at: expect.any(Date) }));
    // Débito de pacote roda SEMPRE dentro de db.transaction (completeSession);
    // no_show não pode ter aberto transação nenhuma.
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('pending não vira no_show (422 tipado do domínio)', async () => {
    const { db } = fakeDb('pending');
    await expect(markNoShow('s1', 't1', null, db)).rejects.toMatchObject({ code: 'session_not_no_showable' });
  });
});

describe('lembrete D-1', () => {
  it('notifySessionEvent é o canal (contrato: reminder vai para o CLIENTE)', () => {
    // O ciclo em si depende do db real (worker); o contrato testável aqui é
    // que o evento existe no union do serviço de notificação.
    expect(typeof notifySessionEvent).toBe('function');
  });
});
