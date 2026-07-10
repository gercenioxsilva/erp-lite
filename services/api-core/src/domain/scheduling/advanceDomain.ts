// Antecedência mínima e janela de cancelamento no FUSO DO TENANT. Puro,
// com `now` injetável (mesmo padrão de defaultBillingDueDate).
//
// Estratégia sem lib de datas: somamos horas no espaço de instantes UTC
// (imune a DST) e SÓ ENTÃO formatamos como wall-clock do tenant via Intl.
// Comparações viram comparação de strings ('YYYY-MM-DD' e 'HH:mm'), a mesma
// moeda em que as sessões são gravadas.

import { SchedulingDomainError, isValidTimezone } from './schedulingDomain';
import { EarliestBookable } from './slotDomain';

export interface WallClock {
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm'
}

/** Wall-clock de um instante num fuso IANA. hourCycle 'h23' evita o quirk
 *  de meia-noite '24:xx' de alguns ICU; o map '24'→'00' é cinto e suspensório. */
export function wallClockInTimezone(tz: string, instant: Date): WallClock {
  if (!isValidTimezone(tz)) {
    throw new SchedulingDomainError('invalid_timezone', { value: tz });
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

/** Primeiro momento agendável: agora + min_advance_hours, no fuso do tenant. */
export function earliestBookableInstant(
  tz: string,
  minAdvanceHours: number,
  now: Date = new Date(),
): EarliestBookable {
  const instant = new Date(now.getTime() + minAdvanceHours * 3_600_000);
  return wallClockInTimezone(tz, instant);
}

/** true quando (data, início) da sessão fica AQUÉM da antecedência mínima. */
export function violatesMinAdvance(
  sessionDate: string,
  sessionStart: string,
  earliest: EarliestBookable,
): boolean {
  if (sessionDate < earliest.date) return true;
  if (sessionDate > earliest.date) return false;
  return sessionStart < earliest.time;
}

/**
 * Janela de cancelamento do CLIENTE (decisão nº 9: não restringe staff).
 * true = o início da sessão está a MENOS de cancel_window_hours de distância
 * (ou já passou) ⇒ cliente não pode mais cancelar. Janela 0 = sem restrição
 * futura (só bloqueia sessões já iniciadas/passadas).
 */
export function withinCancelWindow(
  sessionDate: string,
  sessionStart: string,
  cancelWindowHours: number,
  tz: string,
  now: Date = new Date(),
): boolean {
  const cutoff = wallClockInTimezone(tz, new Date(now.getTime() + cancelWindowHours * 3_600_000));
  if (sessionDate < cutoff.date) return true;
  if (sessionDate > cutoff.date) return false;
  return sessionStart < cutoff.time;
}
