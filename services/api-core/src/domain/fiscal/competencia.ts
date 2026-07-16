// Competência/data fiscal em fuso BRASILEIRO — PURO. O worker roda em UTC e o
// ciclo agendado dispara 23:59 America/Sao_Paulo, que em UTC já é o dia (e o
// mês) seguinte. Carimbar a competência com `new Date()` em UTC arquiva a
// receita do último dia do mês na competência errada, todo fechamento — e o
// UNIQUE de fiscal_revenue_monthly torna o replay um no-op silencioso.
// Por isso a competência SEMPRE vem da data de autorização do documento,
// convertida para o fuso fiscal, nunca do relógio do processo.

export const FISCAL_TZ = 'America/Sao_Paulo';

/** 'YYYY-MM' da data no fuso fiscal (competência da receita/lançamento). */
export function competenciaFromDate(d: Date, tz: string = FISCAL_TZ): string {
  return fiscalDate(d, tz).slice(0, 7);
}

/** 'YYYY-MM-DD' da data no fuso fiscal (data do lançamento contábil). */
export function fiscalDate(d: Date, tz: string = FISCAL_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
