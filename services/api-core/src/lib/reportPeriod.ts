// Helper compartilhado pelos relatórios: normaliza filtros de período vindos da
// query string. Reaproveita o padrão de clamp de reports.ts (top-products:51) e
// centraliza a validação de from/to em um só lugar.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedPeriod {
  from: string; // YYYY-MM-DD
  to:   string; // YYYY-MM-DD
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

/**
 * Extrai `from`/`to` (YYYY-MM-DD) da query. Se ausentes, usa o mês corrente como
 * default. Lança Error com mensagem amigável quando o formato é inválido — o
 * handler deve capturar e devolver reply.badRequest(...).
 */
export function parsePeriod(query: Record<string, unknown>, today = new Date()): ParsedPeriod {
  const rawFrom = query.from;
  const rawTo   = query.to;

  const firstDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const lastDay  = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

  const from = rawFrom === undefined ? firstDay : rawFrom;
  const to   = rawTo   === undefined ? lastDay  : rawTo;

  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    throw new Error('Parâmetros from e to devem estar no formato YYYY-MM-DD.');
  }
  if (from > to) {
    throw new Error('Parâmetro from não pode ser posterior a to.');
  }

  return { from, to };
}

/** Clamp de `days` (janela em dias) para relatórios que usam período relativo. */
export function parseDays(query: Record<string, unknown>, def = 30, min = 1, max = 365): number {
  const raw = Number(query.days ?? def);
  if (!Number.isFinite(raw)) return def;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}
