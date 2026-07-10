// Critérios de aceite: conflito por faixa (carro×moto coexistem, carro×carro
// não; profissionais diferentes nunca conflitam), pendente segura horário como
// confirmada, e a máquina de estados (completed é imutável; recusa exige
// motivo; cliente só cancela o próprio pending).

import { describe, it, expect } from 'vitest';
import {
  conflictsWith, findConflict, isBlockingStatus, SessionStatus,
  assertCanApprove, assertCanDecline, assertCanComplete, assertCanCancel,
  assertCanEdit, assertCanHardDelete, assertClientCanCancel,
} from '../domain/scheduling/sessionDomain';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

const PROF_A = 'prof-a';
const PROF_B = 'prof-b';
const CARRO = 'area-carro';
const MOTO = 'area-moto';

const slot = (professionalId: string, areaId: string, start: string, end: string) =>
  ({ professionalId, areaId, range: { start, end } });

const existing = (professionalId: string, areaId: string, start: string, end: string, status: SessionStatus = 'confirmed') =>
  ({ ...slot(professionalId, areaId, start, end), status });

describe('conflictsWith — regra de faixa (profissional + área)', () => {
  it('mesmo profissional, mesma área, horário sobreposto ⇒ conflito (carro×carro)', () => {
    expect(conflictsWith(
      slot(PROF_A, CARRO, '09:00', '10:00'),
      existing(PROF_A, CARRO, '09:30', '10:30'),
    )).toBe(true);
  });

  it('mesmo profissional, áreas diferentes, mesmo horário ⇒ coexistem (carro×moto)', () => {
    expect(conflictsWith(
      slot(PROF_A, CARRO, '09:00', '10:00'),
      existing(PROF_A, MOTO, '09:00', '10:00'),
    )).toBe(false);
  });

  it('profissionais diferentes nunca conflitam, mesmo área e horário idênticos', () => {
    expect(conflictsWith(
      slot(PROF_A, CARRO, '09:00', '10:00'),
      existing(PROF_B, CARRO, '09:00', '10:00'),
    )).toBe(false);
  });

  it('meio-aberto: sessão terminando 09:00 não conflita com a que começa 09:00', () => {
    expect(conflictsWith(
      slot(PROF_A, CARRO, '09:00', '10:00'),
      existing(PROF_A, CARRO, '08:00', '09:00'),
    )).toBe(false);
  });

  it('pendente segura o horário exatamente como confirmada', () => {
    expect(conflictsWith(
      slot(PROF_A, CARRO, '09:00', '10:00'),
      existing(PROF_A, CARRO, '09:00', '10:00', 'pending'),
    )).toBe(true);
  });

  it('canceladas, recusadas e concluídas liberam o horário', () => {
    for (const status of ['canceled', 'declined', 'completed'] as SessionStatus[]) {
      expect(conflictsWith(
        slot(PROF_A, CARRO, '09:00', '10:00'),
        existing(PROF_A, CARRO, '09:00', '10:00', status),
      )).toBe(false);
    }
  });
});

describe('findConflict', () => {
  it('devolve a sessão conflitante (com seus dados para a mensagem de erro)', () => {
    const sessions = [
      { ...existing(PROF_A, MOTO, '09:00', '10:00'), clientName: 'Maria' },
      { ...existing(PROF_A, CARRO, '09:30', '10:30'), clientName: 'João' },
    ];
    const hit = findConflict(slot(PROF_A, CARRO, '09:00', '10:00'), sessions);
    expect(hit?.clientName).toBe('João');
  });

  it('devolve null quando a agenda está livre na faixa', () => {
    expect(findConflict(slot(PROF_A, CARRO, '09:00', '10:00'), [
      existing(PROF_A, CARRO, '10:00', '11:00'),
    ])).toBeNull();
  });
});

describe('máquina de estados', () => {
  const code = (fn: () => void): string => {
    try { fn(); return ''; } catch (e) { return (e as SchedulingDomainError).code; }
  };

  it('aprovar e recusar exigem status pending', () => {
    expect(() => assertCanApprove('pending')).not.toThrow();
    expect(code(() => assertCanApprove('confirmed'))).toBe('session_not_pending');
    expect(code(() => assertCanDecline('confirmed', 'motivo'))).toBe('session_not_pending');
  });

  it('recusa exige motivo não-vazio', () => {
    expect(code(() => assertCanDecline('pending', ''))).toBe('decline_reason_required');
    expect(code(() => assertCanDecline('pending', '   '))).toBe('decline_reason_required');
    expect(() => assertCanDecline('pending', 'agenda cheia')).not.toThrow();
  });

  it('concluir exige confirmed — concluir duas vezes falha', () => {
    expect(() => assertCanComplete('confirmed')).not.toThrow();
    expect(code(() => assertCanComplete('completed'))).toBe('session_not_completable');
    expect(code(() => assertCanComplete('pending'))).toBe('session_not_completable');
  });

  it('completed é imutável: não edita, não cancela, não exclui', () => {
    expect(code(() => assertCanEdit('completed'))).toBe('session_not_editable');
    expect(code(() => assertCanCancel('completed'))).toBe('session_not_cancelable');
    expect(code(() => assertCanHardDelete('completed'))).toBe('session_completed_immutable');
  });

  it('excluir de verdade é permitido para qualquer não-concluída', () => {
    for (const status of ['pending', 'confirmed', 'canceled', 'declined'] as SessionStatus[]) {
      expect(() => assertCanHardDelete(status)).not.toThrow();
    }
  });

  it('cliente só cancela a própria solicitação pendente', () => {
    expect(() => assertClientCanCancel('pending')).not.toThrow();
    expect(code(() => assertClientCanCancel('confirmed'))).toBe('client_cancel_only_pending');
  });

  it('isBlockingStatus cobre exatamente pending e confirmed', () => {
    expect(isBlockingStatus('pending')).toBe(true);
    expect(isBlockingStatus('confirmed')).toBe(true);
    expect(isBlockingStatus('completed')).toBe(false);
    expect(isBlockingStatus('canceled')).toBe(false);
    expect(isBlockingStatus('declined')).toBe(false);
  });
});
