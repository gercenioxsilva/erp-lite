// Domínio de Visita Técnica — regras de negócio puras, sem I/O.
//
// Modelo de segurança: routing_token é só ROTEAMENTO (qual visita mostrar após
// login), nunca autorização — a autorização real é feita na camada de serviço
// (JWT do técnico + technician_id da visita batendo com o technicianId do
// token), fora deste arquivo. Aqui só validamos as regras de negócio: pode
// fazer check-in? pode subir foto? pode assinar? o link ainda é válido?

export type ServiceVisitStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

const VALID_TRANSITIONS: Record<ServiceVisitStatus, ServiceVisitStatus[]> = {
  scheduled:   ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed:   [], // terminal
  cancelled:   [], // terminal
  no_show:     [], // terminal
};

export class ServiceVisitDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'ServiceVisitDomainError';
  }
}

export function assertServiceVisitTransition(from: ServiceVisitStatus, to: ServiceVisitStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new ServiceVisitDomainError('invalid_service_visit_transition', {
      from, to, allowed: VALID_TRANSITIONS[from],
    });
  }
}

// ── Validade do link de roteamento ───────────────────────────────────────────
// O link expira (diferente do token indefinido de proposals) — reduz a janela
// de exposição de um link que passa pelo e-mail de um técnico.

export function isRoutingTokenValid(tokenExpiresAt: Date, status: ServiceVisitStatus, now: Date = new Date()): boolean {
  const TERMINAL = new Set<ServiceVisitStatus>(['completed', 'cancelled', 'no_show']);
  if (TERMINAL.has(status)) return false;
  return now < tokenExpiresAt;
}

// ── Elegibilidade de ações — checadas ANTES da autorização de identidade,
//    que é responsabilidade da camada de serviço/rota ─────────────────────────

export function canCheckIn(status: ServiceVisitStatus): boolean {
  return status === 'scheduled';
}

export function canUploadPhoto(status: ServiceVisitStatus): boolean {
  return status === 'in_progress';
}

export function canCaptureSignature(status: ServiceVisitStatus): boolean {
  return status === 'in_progress';
}

export function canComplete(status: ServiceVisitStatus, hasCheckedIn: boolean): boolean {
  return status === 'in_progress' && hasCheckedIn;
}

// ── CPF ───────────────────────────────────────────────────────────────────────
// Mesmo algoritmo de apps/backoffice/src/lib/brazil.ts (isValidCPF) — replicado
// aqui porque backend e frontend são projetos TypeScript separados sem lib
// compartilhada (mesmo raciocínio de cnpjDomain.ts existir ao lado de brazil.ts
// no CNPJ alfanumérico). Nunca confiar só na validação client-side para um
// campo com peso probatório.

export function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

export function isValidCPF(v: string): boolean {
  const d = digitsOnly(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;

  const calc = (n: number): number => {
    let sum = 0;
    for (let i = 0; i < n - 1; i++) sum += Number(d[i]) * (n - i);
    const rem = (sum * 10) % 11;
    return rem === 10 ? 0 : rem;
  };

  return calc(10) === Number(d[9]) && calc(11) === Number(d[10]);
}

// ── Validação de criação ─────────────────────────────────────────────────────

export interface ServiceVisitCreateInput {
  scheduledAt: Date;
}

export function validateServiceVisitCreate(input: ServiceVisitCreateInput, now: Date = new Date()): void {
  if (input.scheduledAt < now) {
    throw new ServiceVisitDomainError('service_visit_scheduled_in_past');
  }
}
