// Domínio do Aging (posição de vencimentos) — puro, sem I/O.
// Classifica títulos em aberto (a receber ou a pagar) por faixa de atraso e
// totaliza cada faixa. O service faz a query; esta função apenas agrupa.

export type AgingBucketKey = 'not_due' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export const AGING_BUCKET_ORDER: AgingBucketKey[] = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

export interface AgingItemInput {
  id:           string;
  party_name:   string | null; // cliente (receber) ou fornecedor (pagar)
  description:  string;
  due_date:     string;        // YYYY-MM-DD
  remaining:    number;        // amount - paid_amount
  days_overdue: number;        // as_of - due_date (negativo = ainda a vencer)
}

export interface AgingItem extends AgingItemInput {
  bucket: AgingBucketKey;
}

export interface AgingBucketTotal {
  key:   AgingBucketKey;
  count: number;
  total: number;
}

export interface AgingResult {
  as_of:   string;
  type:    'receivable' | 'payable';
  buckets: AgingBucketTotal[];
  items:   AgingItem[];
  total:   number;
  count:   number;
}

/** Mapeia dias de atraso para a faixa. days_overdue <= 0 → ainda a vencer. */
export function bucketOf(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0)  return 'not_due';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd90_plus';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildAging(
  type:  'receivable' | 'payable',
  asOf:  string,
  input: AgingItemInput[],
): AgingResult {
  const items: AgingItem[] = input.map(i => ({ ...i, bucket: bucketOf(i.days_overdue) }));

  const buckets: AgingBucketTotal[] = AGING_BUCKET_ORDER.map(key => {
    const inBucket = items.filter(i => i.bucket === key);
    return {
      key,
      count: inBucket.length,
      total: round2(inBucket.reduce((s, i) => s + i.remaining, 0)),
    };
  });

  return {
    as_of: asOf,
    type,
    buckets,
    items,
    total: round2(items.reduce((s, i) => s + i.remaining, 0)),
    count: items.length,
  };
}
