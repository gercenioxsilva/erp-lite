// Util monetário canônico do projeto. O round2 estava duplicado em vários
// arquivos (taxEngine, dreDomain, lambda-fiscal…); código novo importa daqui.
// A migração das cópias existentes é gradual — não alterar comportamento.

/** Arredonda para 2 casas decimais (centavos). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converte um DECIMAL do Postgres (string, ex.: '1234.50') em number.
 * NULL/undefined/'' viram 0 — o padrão dos agregadores de relatório do repo.
 */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Formata um number como string DECIMAL(…,2) para persistir no Postgres. */
export function toDecimalString(n: number): string {
  return round2(n).toFixed(2);
}
