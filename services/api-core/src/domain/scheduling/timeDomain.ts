// Datas e horários do agendamento — puro, sem I/O.
//
// Horários são wall-clock do tenant em strings 'HH:mm' zero-padded: a
// comparação lexicográfica é idêntica à cronológica ('09:00' < '10:30'),
// então todo o domínio compara strings direto, sem Date. Datas são strings
// 'YYYY-MM-DD' (mesma convenção de lib/reportPeriod.ts).
//
// Intervalos são SEMPRE meio-abertos [start, end): terminar às 09:00 não
// conflita com começar às 09:00 (regra crítica nº 1 do módulo).

import { SchedulingDomainError } from './schedulingDomain';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TimeRange {
  start: string; // 'HH:mm' inclusivo
  end:   string; // 'HH:mm' exclusivo
}

export function isValidHm(s: string): boolean {
  return TIME_RE.test(s);
}

export function isValidDateISO(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function hmToMinutes(s: string): number {
  if (!isValidHm(s)) throw new SchedulingDomainError('invalid_time_format', { value: s });
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

export function minutesToHm(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 24 * 60) {
    throw new SchedulingDomainError('invalid_time_format', { value: n });
  }
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function assertValidRange(r: TimeRange): void {
  if (!isValidHm(r.start) || !isValidHm(r.end) || r.start >= r.end) {
    throw new SchedulingDomainError('invalid_time_range', { start: r.start, end: r.end });
  }
}

/** Overlap meio-aberto: [a.start, a.end) ∩ [b.start, b.end) ≠ ∅. */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Ordena e funde faixas que se sobrepõem OU se encostam (fim == início). */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: TimeRange[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) merged[merged.length - 1] = { start: last.start, end: cur.end };
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/** Subtrai [cut) de [base): devolve 0, 1 ou 2 fragmentos remanescentes. */
export function subtractRange(base: TimeRange, cut: TimeRange): TimeRange[] {
  if (!overlaps(base, cut)) return [{ ...base }];
  const out: TimeRange[] = [];
  if (cut.start > base.start) out.push({ start: base.start, end: cut.start });
  if (cut.end < base.end) out.push({ start: cut.end, end: base.end });
  return out;
}

/** Subtrai todas as faixas de corte de todas as faixas-base. */
export function subtractAll(bases: TimeRange[], cuts: TimeRange[]): TimeRange[] {
  let result = bases.map(b => ({ ...b }));
  for (const cut of cuts) {
    result = result.flatMap(b => subtractRange(b, cut));
  }
  return result;
}

/** Soma dias a uma data ISO — aritmética UTC, imune a fuso/DST do servidor. */
export function addDaysISO(dateISO: string, days: number): string {
  if (!isValidDateISO(dateISO)) throw new SchedulingDomainError('invalid_date_format', { value: dateISO });
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Dia da semana de uma data ISO: 0=domingo … 6=sábado (Date.getUTCDay —
 *  mesma convenção gravada em scheduling_availability_rules.weekday). */
export function weekdayOf(dateISO: string): number {
  if (!isValidDateISO(dateISO)) throw new SchedulingDomainError('invalid_date_format', { value: dateISO });
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
