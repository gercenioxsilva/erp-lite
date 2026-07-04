// Domínio da Curva ABC — classificação pura (sem I/O) por participação acumulada.
// A: até 80% acumulado. B: até 95%. C: restante. O service agrega faturamento/margem
// por produto; esta função apenas ordena, acumula e classifica.

export interface AbcItemInput {
  name: string;
  sku: string | null;
  quantity: number;
  revenue: number;
  margin: number;
}

export type AbcClass = 'A' | 'B' | 'C';

export interface AbcItem extends AbcItemInput {
  value: number;
  rank: number;
  cumulative_pct: number;
  class: AbcClass;
}

export interface AbcResult {
  metric: 'revenue' | 'margin';
  items: AbcItem[];
  summary: {
    class_a: { count: number; total: number };
    class_b: { count: number; total: number };
    class_c: { count: number; total: number };
    grand_total: number;
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classify(cumulativePct: number): AbcClass {
  if (cumulativePct <= 80) return 'A';
  if (cumulativePct <= 95) return 'B';
  return 'C';
}

export function buildAbcCurve(items: AbcItemInput[], metric: 'revenue' | 'margin'): AbcResult {
  const emptySummary = {
    class_a: { count: 0, total: 0 }, class_b: { count: 0, total: 0 }, class_c: { count: 0, total: 0 }, grand_total: 0,
  };

  const withValue = items.map(i => ({ ...i, value: metric === 'revenue' ? i.revenue : i.margin }));
  const grandTotal = round2(withValue.reduce((s, i) => s + i.value, 0));

  if (grandTotal <= 0) {
    return { metric, items: [], summary: emptySummary };
  }

  const sorted = [...withValue].sort((a, b) => b.value - a.value);

  let cumulative = 0;
  const classified: AbcItem[] = sorted.map((it, idx) => {
    cumulative += it.value;
    const cumulative_pct = round1((cumulative / grandTotal) * 100);
    return { ...it, value: round2(it.value), rank: idx + 1, cumulative_pct, class: classify(cumulative_pct) };
  });

  const summarize = (cls: AbcClass) => {
    const inClass = classified.filter(i => i.class === cls);
    return { count: inClass.length, total: round2(inClass.reduce((s, i) => s + i.value, 0)) };
  };

  return {
    metric,
    items: classified,
    summary: {
      class_a: summarize('A'),
      class_b: summarize('B'),
      class_c: summarize('C'),
      grand_total: grandTotal,
    },
  };
}
