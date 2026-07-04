// Tokens de visualização + formatação, compartilhados por todos os relatórios.
// Cores alinhadas ao DS (index.css) e validadas para CVD/contraste (dataviz):
//   node scripts/validate_palette.js "3B5CE4,0891b2,16a34a,d97706,dc2626,7c3aed,db2777,0d9488" --mode light → ALL PASS

// Ordem categórica FIXA — nunca ciclar; a 9ª série vira "Outros".
export const CATEGORICAL = [
  '#3B5CE4', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0d9488',
] as const;

// Cores semânticas (polaridade). Sempre acompanhadas de rótulo/posição (a cor
// verde/vermelho nunca é o único canal de identidade).
export const SEMANTIC = {
  inflow:      '#16a34a', // entradas (realizado)
  inflowSoft:  '#6ee7b7', // entradas (projetado) — segmento empilhado mais claro
  outflow:     '#dc2626', // saídas (realizado)
  outflowSoft: '#fca5a5', // saídas (projetado)
  balance:     '#3B5CE4', // saldo acumulado (linha)
  neutral:     '#94a3b8',
} as const;

// Rampa de severidade do Aging (a vencer → crítico). Ordenada por gravidade.
export const AGING_COLORS: Record<string, string> = {
  not_due:  '#16a34a',
  d1_30:    '#d97706',
  d31_60:   '#ea580c',
  d61_90:   '#dc2626',
  d90_plus: '#991b1b',
};

export const AGING_LABELS: Record<string, string> = {
  not_due:  'A vencer',
  d1_30:    '1–30 dias',
  d31_60:   '31–60 dias',
  d61_90:   '61–90 dias',
  d90_plus: '+90 dias',
};

export function categoricalColor(index: number): string {
  return CATEGORICAL[index % CATEGORICAL.length];
}

// ── Formatação (pt-BR) ────────────────────────────────────────────────────────

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
});

export const fmtBRL     = (n: number) => BRL.format(n);
export const fmtCompact = (n: number) => BRL_COMPACT.format(n);
export const fmtInt     = (n: number) => n.toLocaleString('pt-BR');
export const fmtPct     = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

/** Data ISO (YYYY-MM-DD ou timestamp) → dd/mm/aaaa, fixando meio-dia UTC p/ evitar off-by-one. */
export function fmtDate(iso: string): string {
  const base = iso.length > 10 ? iso : `${iso}T12:00:00Z`;
  return new Date(base).toLocaleDateString('pt-BR');
}

/** Rótulo curto de bucket temporal por granularidade. */
export function fmtBucket(iso: string, granularity: 'week' | 'month'): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return granularity === 'month'
    ? d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}
