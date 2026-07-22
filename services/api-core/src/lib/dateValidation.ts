const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida formato YYYY-MM-DD e calendário real (rejeita 2026-02-30) — evita
 *  que uma string malformada vire erro 500 do Postgres numa coluna `date`. */
export function isValidISODate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
