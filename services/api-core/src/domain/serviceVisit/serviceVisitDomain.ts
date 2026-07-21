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

// ── Agenda / conflito de horário ─────────────────────────────────────────────
// Intervalo SEMPRE meio-aberto [start, end) — mesma convenção do módulo de
// Agendamento (domain/scheduling/timeDomain.ts): terminar às 09:00 não
// conflita com começar às 09:00. Diferente do Agendamento, aqui o intervalo
// nasce de um instante absoluto (scheduled_at + duration_minutes), não de
// strings 'HH:mm' de wall-clock — não há grade de disponibilidade nem fuso de
// tenant nesta camada, então comparar Date direto é suficiente e mais simples.
//
// Deliberadamente NÃO importa nada de domain/scheduling — são dois domínios
// de negócio diferentes (visita técnica com checklist/foto/assinatura vs.
// sessão com pacote) que só coincidem em "alguém tem um horário reservado";
// a pequena duplicação de overlap() evita acoplar um bounded context ao
// outro por um utilitário de 3 linhas.

export const DEFAULT_VISIT_DURATION_MINUTES = 60;

export interface VisitTimeRange {
  start: Date;
  end:   Date;
}

export function visitTimeRange(scheduledAt: Date, durationMinutes: number): VisitTimeRange {
  return { start: scheduledAt, end: new Date(scheduledAt.getTime() + durationMinutes * 60_000) };
}

/** Overlap meio-aberto: [a.start, a.end) ∩ [b.start, b.end) ≠ ∅. */
export function visitRangesOverlap(a: VisitTimeRange, b: VisitTimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface VisitSlot {
  technicianId: string;
  range:        VisitTimeRange;
}

const BLOCKING_VISIT_STATUSES = new Set<ServiceVisitStatus>(['scheduled', 'in_progress']);

export function isBlockingVisitStatus(status: ServiceVisitStatus): boolean {
  return BLOCKING_VISIT_STATUSES.has(status);
}

/** Mesmo técnico + intervalos se sobrepondo + status que ainda segura o
 *  horário (scheduled/in_progress — cancelled/completed/no_show liberam). */
export function visitConflictsWith(
  candidate: VisitSlot,
  existing: VisitSlot & { status: ServiceVisitStatus },
): boolean {
  return (
    candidate.technicianId === existing.technicianId &&
    isBlockingVisitStatus(existing.status) &&
    visitRangesOverlap(candidate.range, existing.range)
  );
}

/** Primeira visita existente que conflita com a candidata, ou null. */
export function findVisitConflict<T extends VisitSlot & { status: ServiceVisitStatus }>(
  candidate: VisitSlot,
  existing: T[],
): T | null {
  for (const v of existing) {
    if (visitConflictsWith(candidate, v)) return v;
  }
  return null;
}
