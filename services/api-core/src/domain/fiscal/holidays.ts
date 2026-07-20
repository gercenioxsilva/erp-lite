// Feriados NACIONAIS do Brasil (E9) — usado no cálculo do vencimento do DAS
// (dia útil). Cobre os fixos + os móveis derivados da Páscoa (algoritmo de
// Meeus/Butcher). Feriados MUNICIPAIS/ESTADUAIS ficam fora de escopo
// (limitação documentada) — variam por cidade e não temos esse cadastro.

/** Domingo de Páscoa do ano (Meeus/Butcher, calendário gregoriano). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

/** Conjunto 'YYYY-MM-DD' dos feriados nacionais do ano (fixos + móveis). */
export function nationalHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const fixos = [
    `${year}-01-01`, // Confraternização Universal
    `${year}-04-21`, // Tiradentes
    `${year}-05-01`, // Dia do Trabalho
    `${year}-09-07`, // Independência
    `${year}-10-12`, // Nossa Senhora Aparecida
    `${year}-11-02`, // Finados
    `${year}-11-15`, // Proclamação da República
    `${year}-11-20`, // Consciência Negra (feriado nacional desde 2024)
    `${year}-12-25`, // Natal
  ];
  const moveis = [
    iso(addDays(easter, -47)), // Carnaval (terça)
    iso(addDays(easter, -2)),  // Sexta-feira Santa
    iso(addDays(easter, 60)),  // Corpus Christi
  ];
  return new Set([...fixos, ...moveis]);
}

/** Dia útil = não é fim de semana nem feriado nacional. */
export function isBusinessDay(date: Date, holidays: Set<string>): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(iso(date));
}
