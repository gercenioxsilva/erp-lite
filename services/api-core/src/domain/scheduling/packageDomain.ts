// Pacote de sessões do cliente — saldo e débito. Puro.
//
// Saldo é SEMPRE derivado (total - usadas), nunca persistido como coluna
// própria. Débito acontece EXCLUSIVAMENTE na conclusão da sessão (regra
// crítica nº 5), 1 por conclusão, dentro da transação da camada de serviço.
// Agendar NÃO consome nem exige saldo (decisão nº 8 do design): o pacote é
// vínculo/controle, não gating — por isso assertPackageUsableForBooking só
// roda quando um pacote foi de fato escolhido no agendamento.

import { SchedulingDomainError } from './schedulingDomain';

export type PackageStatus = 'active' | 'exhausted' | 'expired' | 'canceled';
export type PaymentStatus = 'pending' | 'partial' | 'paid';

export interface PackageBalance {
  totalSessions: number;
  usedSessions:  number;
}

export function remainingSessions(pkg: PackageBalance): number {
  return pkg.totalSessions - pkg.usedSessions;
}

export interface PackageUsability extends PackageBalance {
  status:     PackageStatus;
  areaId:     string | null; // null = vale para qualquer área
  validUntil: string | null; // 'YYYY-MM-DD'
}

/**
 * Valida o pacote ESCOLHIDO para um agendamento: status, validade e área.
 * Pacote de área específica só cobre sessões daquela área; area_id null cobre
 * qualquer área (a área concreta é sempre resolvida no fluxo de booking —
 * decisão nº 4: toda sessão tem área).
 */
export function assertPackageUsableForBooking(
  pkg: PackageUsability,
  chosenAreaId: string,
  todayISO: string,
): void {
  if (pkg.status !== 'active') {
    throw new SchedulingDomainError('package_not_active', { status: pkg.status });
  }
  if (pkg.validUntil !== null && todayISO > pkg.validUntil) {
    throw new SchedulingDomainError('package_expired', { valid_until: pkg.validUntil });
  }
  if (remainingSessions(pkg) <= 0) {
    throw new SchedulingDomainError('package_exhausted');
  }
  if (pkg.areaId !== null && pkg.areaId !== chosenAreaId) {
    throw new SchedulingDomainError('package_area_mismatch', {
      package_area_id: pkg.areaId, chosen_area_id: chosenAreaId,
    });
  }
}

export interface DebitResult {
  usedSessions: number;
  status:       'active' | 'exhausted';
}

/**
 * Débito de exatamente 1 sessão. Sem saldo ⇒ erro (saldo nunca fica
 * negativo — o CHECK used<=total no banco é o backstop físico). Saldo
 * chegando a zero ⇒ pacote vira 'exhausted' na mesma operação.
 */
export function applyDebit(pkg: PackageBalance): DebitResult {
  if (remainingSessions(pkg) <= 0) {
    throw new SchedulingDomainError('package_no_balance', {
      total_sessions: pkg.totalSessions, used_sessions: pkg.usedSessions,
    });
  }
  const usedSessions = pkg.usedSessions + 1;
  return {
    usedSessions,
    status: usedSessions >= pkg.totalSessions ? 'exhausted' : 'active',
  };
}
