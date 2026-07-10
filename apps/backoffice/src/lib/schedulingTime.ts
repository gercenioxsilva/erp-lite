// Datas e horários do módulo de Agendamento — espelho leve do domínio do
// backend (services/api-core/src/domain/scheduling/timeDomain.ts): horários
// 'HH:mm' zero-padded (comparação de string ≡ cronológica), datas 'YYYY-MM-DD'
// com aritmética em UTC (imune ao fuso do navegador). Sem lib de datas, como
// no resto do backoffice.

export interface TimeRange {
  start: string;
  end:   string;
}

export const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAY_LABELS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function hmToMinutes(s: string): number {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

export function minutesToHm(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 0=domingo … 6=sábado — mesma convenção do backend. */
export function weekdayOf(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Domingo…sábado da semana que contém a data. */
export function weekOf(dateISO: string): string[] {
  const start = addDaysISO(dateISO, -weekdayOf(dateISO));
  return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
}

export function formatDateBR(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/** "seg., 20 de jul." — cabeçalhos de calendário e listas. */
export function formatDateShortBR(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
  });
}
