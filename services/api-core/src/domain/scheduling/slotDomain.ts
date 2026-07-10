// Engine de slots do auto-agendamento (regra crítica nº 7). Puro.
//
// slots(dia) = (grade semanal ∪ aberturas extras) − bloqueios − ocupados da
// MESMA (profissional, área), fatiados na duração da área, respeitando a
// antecedência mínima. Grade vazia ⇒ NADA ofertado (nunca "tudo livre").
// Resto de faixa menor que a duração é descartado.
//
// O corte de antecedência filtra os slots já fatiados (mantém a âncora dos
// horários na grade — o aluno vê 09:00/10:00, não 09:17) e zera dias
// anteriores à data mínima.

import { SchedulingDomainError } from './schedulingDomain';
import {
  TimeRange, assertValidRange, hmToMinutes, minutesToHm,
  mergeRanges, subtractAll, isValidDateISO,
} from './timeDomain';

export interface AvailabilityException {
  kind:      'block' | 'open';
  startTime: string | null; // null em 'block' = dia inteiro bloqueado
  endTime:   string | null;
}

export interface EarliestBookable {
  date: string; // 'YYYY-MM-DD' no fuso do tenant
  time: string; // 'HH:mm'
}

export interface ComputeSlotsArgs {
  weeklyRanges:    TimeRange[];              // faixas da grade para o weekday da data
  exceptions:      AvailabilityException[];  // exceções da data
  occupied:        TimeRange[];              // sessões bloqueantes da mesma (profissional, área)
  durationMinutes: number;                   // duração da área
  date:            string;                   // 'YYYY-MM-DD'
  earliest:        EarliestBookable | null;  // null = sem corte de antecedência (uso admin)
}

export function computeFreeSlots(args: ComputeSlotsArgs): TimeRange[] {
  if (!Number.isInteger(args.durationMinutes) || args.durationMinutes <= 0) {
    throw new SchedulingDomainError('invalid_duration', { value: args.durationMinutes });
  }
  if (!isValidDateISO(args.date)) {
    throw new SchedulingDomainError('invalid_date_format', { value: args.date });
  }

  // Antecedência zera dias inteiros antes da data mínima.
  if (args.earliest && args.date < args.earliest.date) return [];

  // Bloqueio de dia inteiro (kind='block' sem horários) zera o dia.
  if (args.exceptions.some(e => e.kind === 'block' && e.startTime === null)) return [];

  // Base = grade semanal ∪ aberturas extras (mescladas — abertura encostada
  // na grade vira uma faixa contínua).
  const openings = args.exceptions
    .filter(e => e.kind === 'open' && e.startTime !== null && e.endTime !== null)
    .map(e => ({ start: e.startTime as string, end: e.endTime as string }));
  const base = mergeRanges([...args.weeklyRanges, ...openings]);
  if (base.length === 0) return []; // grade vazia: nada ofertado

  // − bloqueios parciais − ocupados (ambos meio-abertos).
  const blocks = args.exceptions
    .filter(e => e.kind === 'block' && e.startTime !== null && e.endTime !== null)
    .map(e => ({ start: e.startTime as string, end: e.endTime as string }));
  const free = subtractAll(subtractAll(base, blocks), args.occupied);

  // Fatia cada faixa livre em slots consecutivos ancorados no início da faixa;
  // o resto final menor que a duração é descartado.
  const slots: TimeRange[] = [];
  for (const range of free) {
    let cursor = hmToMinutes(range.start);
    const end = hmToMinutes(range.end);
    while (cursor + args.durationMinutes <= end) {
      slots.push({ start: minutesToHm(cursor), end: minutesToHm(cursor + args.durationMinutes) });
      cursor += args.durationMinutes;
    }
  }

  // Corte de antecedência no próprio dia: remove slots que começam cedo demais.
  if (args.earliest && args.date === args.earliest.date) {
    const cutoff = args.earliest.time;
    return slots.filter(s => s.start >= cutoff);
  }
  return slots;
}

// ── Validação de entrada da disponibilidade (grade e exceções) ────────────────

export interface WeeklyRuleInput {
  weekday:   number; // 0=domingo … 6=sábado
  startTime: string;
  endTime:   string;
}

export function validateWeeklyRule(rule: WeeklyRuleInput): void {
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
    throw new SchedulingDomainError('invalid_weekday', { value: rule.weekday });
  }
  assertValidRange({ start: rule.startTime, end: rule.endTime });
}

export interface ExceptionInput {
  kind:      'block' | 'open';
  startTime: string | null;
  endTime:   string | null;
}

export function validateException(ex: ExceptionInput): void {
  const hasStart = ex.startTime !== null && ex.startTime !== undefined;
  const hasEnd = ex.endTime !== null && ex.endTime !== undefined;
  if (hasStart !== hasEnd) {
    throw new SchedulingDomainError('invalid_exception', { reason: 'horários devem vir em par' });
  }
  if (ex.kind === 'open' && !hasStart) {
    throw new SchedulingDomainError('invalid_exception', { reason: 'abertura extra exige horários' });
  }
  if (hasStart) {
    assertValidRange({ start: ex.startTime as string, end: ex.endTime as string });
  }
}
