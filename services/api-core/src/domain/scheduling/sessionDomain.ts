// Sessão de agendamento — predicado de conflito + máquina de estados. Puro.
//
// Regra de conflito (decisão nº 5 do design): duas sessões competem quando
// são do MESMO profissional E da MESMA área E os intervalos meio-abertos se
// sobrepõem. Áreas diferentes do mesmo profissional coexistem (recursos
// paralelos — carro×moto na autoescola); profissionais diferentes nunca
// conflitam entre si. 'pending' segura o horário exatamente como 'confirmed'
// (regra crítica nº 3).

import { SchedulingDomainError } from './schedulingDomain';
import { TimeRange, overlaps } from './timeDomain';

export type SessionStatus = 'pending' | 'confirmed' | 'completed' | 'canceled' | 'declined';

export const BLOCKING_STATUSES: readonly SessionStatus[] = ['pending', 'confirmed'];

export function isBlockingStatus(status: SessionStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export interface SessionSlot {
  professionalId: string;
  areaId:         string;
  range:          TimeRange;
}

export function conflictsWith(
  candidate: SessionSlot,
  existing: SessionSlot & { status: SessionStatus },
): boolean {
  return (
    candidate.professionalId === existing.professionalId &&
    candidate.areaId === existing.areaId &&
    isBlockingStatus(existing.status) &&
    overlaps(candidate.range, existing.range)
  );
}

/** Primeira sessão existente que conflita com a candidata, ou null. */
export function findConflict<T extends SessionSlot & { status: SessionStatus }>(
  candidate: SessionSlot,
  existing: T[],
): T | null {
  for (const s of existing) {
    if (conflictsWith(candidate, s)) return s;
  }
  return null;
}

// ── Máquina de estados ────────────────────────────────────────────────────────
// pending    → confirmed (aprovar) | declined (recusar) | canceled
// confirmed  → completed (concluir, debita pacote) | canceled
// completed  → TERMINAL E IMUTÁVEL (regra crítica nº 5: sem editar, cancelar,
//              excluir ou re-concluir)
// canceled / declined → terminais (histórico auditado; excluível)

export function assertCanApprove(status: SessionStatus): void {
  if (status !== 'pending') {
    throw new SchedulingDomainError('session_not_pending', { status });
  }
}

export function assertCanDecline(status: SessionStatus, reason: string | null | undefined): void {
  if (status !== 'pending') {
    throw new SchedulingDomainError('session_not_pending', { status });
  }
  if (!reason || reason.trim() === '') {
    throw new SchedulingDomainError('decline_reason_required');
  }
}

export function assertCanComplete(status: SessionStatus): void {
  if (status !== 'confirmed') {
    throw new SchedulingDomainError('session_not_completable', { status });
  }
}

export function assertCanCancel(status: SessionStatus): void {
  if (status !== 'pending' && status !== 'confirmed') {
    throw new SchedulingDomainError('session_not_cancelable', { status });
  }
}

export function assertCanEdit(status: SessionStatus): void {
  if (status !== 'pending' && status !== 'confirmed') {
    throw new SchedulingDomainError('session_not_editable', { status });
  }
}

/** Excluir de verdade: qualquer status EXCETO completed (regra nº 6). */
export function assertCanHardDelete(status: SessionStatus): void {
  if (status === 'completed') {
    throw new SchedulingDomainError('session_completed_immutable');
  }
}

/** Cliente só cancela a própria solicitação ainda pendente (regra nº 7). */
export function assertClientCanCancel(status: SessionStatus): void {
  if (status !== 'pending') {
    throw new SchedulingDomainError('client_cancel_only_pending', { status });
  }
}
