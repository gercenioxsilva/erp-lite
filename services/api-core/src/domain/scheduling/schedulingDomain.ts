// Domínio de Agendamento — regras de negócio puras, sem I/O (não conhece
// Fastify, Drizzle nem infraestrutura). Design em
// docs/superpowers/specs/2026-07-09-scheduling-module-design.md.
//
// Este arquivo concentra o erro de domínio do módulo e a validação da
// configuração por tenant. As demais regras vivem ao lado: timeDomain
// (datas/horários HH:mm), sessionDomain (conflito + máquina de estados),
// slotDomain (engine de slots), packageDomain (saldo/débito) e advanceDomain
// (antecedência mínima e janela de cancelamento no fuso do tenant).

export class SchedulingDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'SchedulingDomainError';
  }
}

// Valida contra o banco de dados de fusos do ICU embarcado no Node — é o mesmo
// runtime que fará a conta de wall-clock depois, então aceitar aqui ≡ funcionar lá.
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface SchedulingSettingsPatch {
  minAdvanceHours?: number;
  cancelWindowHours?: number;
  timezone?: string;
}

export function validateSettingsPatch(patch: SchedulingSettingsPatch): void {
  if (patch.minAdvanceHours !== undefined &&
      (!Number.isInteger(patch.minAdvanceHours) || patch.minAdvanceHours < 0)) {
    throw new SchedulingDomainError('invalid_min_advance', { value: patch.minAdvanceHours });
  }
  if (patch.cancelWindowHours !== undefined &&
      (!Number.isInteger(patch.cancelWindowHours) || patch.cancelWindowHours < 0)) {
    throw new SchedulingDomainError('invalid_cancel_window', { value: patch.cancelWindowHours });
  }
  if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
    throw new SchedulingDomainError('invalid_timezone', { value: patch.timezone });
  }
}
