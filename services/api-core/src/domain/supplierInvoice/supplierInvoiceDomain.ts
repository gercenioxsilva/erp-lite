// Domínio de NF-e de Entrada — regras de negócio puras, sem I/O.

export type SIStatus = 'draft' | 'confirmed' | 'cancelled' | 'divergence';

export class SupplierInvoiceDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'SupplierInvoiceDomainError';
  }
}

// ── State machine ─────────────────────────────────────────────────────────────
// draft → confirmed | cancelled | divergence
// confirmed → cancelled          (cancelamento pós recebimento — excepcional)
// divergence → confirmed | cancelled

const VALID_TRANSITIONS: Record<SIStatus, SIStatus[]> = {
  draft:      ['confirmed', 'cancelled', 'divergence'],
  confirmed:  ['cancelled'],
  cancelled:  [],
  divergence: ['confirmed', 'cancelled'],
};

export function assertSITransition(from: SIStatus, to: SIStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new SupplierInvoiceDomainError('invalid_si_transition', {
      from, to, allowed: VALID_TRANSITIONS[from],
    });
  }
}

// ── Matching com Pedido de Compra (3-way match) ───────────────────────────────
// Retorna 'ok' | 'quantity_divergence' | 'price_divergence'

export interface MatchItem {
  material_id?: string | null;
  quantity:     number;
  unit_price:   number;
}

export type MatchResult = 'ok' | 'quantity_divergence' | 'price_divergence' | 'no_po';

export function matchAgainstPO(
  siItems: MatchItem[],
  poItems: MatchItem[],
): MatchResult {
  if (!poItems.length) return 'no_po';

  for (const si of siItems) {
    const po = poItems.find(p => p.material_id && p.material_id === si.material_id);
    if (!po) continue;
    const qtDiff  = Math.abs(si.quantity - po.quantity);
    const pricDiff = Math.abs(si.unit_price - po.unit_price);
    if (qtDiff   > 0.001) return 'quantity_divergence';
    if (pricDiff > 0.01)  return 'price_divergence';
  }
  return 'ok';
}

// ── Validação de entrada ──────────────────────────────────────────────────────

export interface SICreateInput {
  items: Array<{ quantity: number; unit_price: number }>;
  total: number;
}

export function validateSICreate(input: SICreateInput): void {
  if (!input.items.length) {
    throw new SupplierInvoiceDomainError('si_no_items');
  }
  for (const it of input.items) {
    if (it.quantity <= 0) throw new SupplierInvoiceDomainError('si_item_quantity_zero');
    if (it.unit_price < 0) throw new SupplierInvoiceDomainError('si_item_price_negative');
  }
}

// ── Parcelamento ───────────────────────────────────────────────────────────────
// Modo automático mensal: usuário só informa o número de parcelas e o
// vencimento da 1ª; as demais são geradas mensalmente, com o total dividido
// igualmente e o resto de centavos absorvido pela última parcela.

/** Divide `total` em `count` valores cuja soma bate exatamente com `total`. */
export function splitInstallmentAmounts(total: number, count: number): number[] {
  if (count <= 1) return [Math.round(total * 100) / 100];

  const totalCents = Math.round(total * 100);
  const base        = Math.floor(totalCents / count);
  const remainder    = totalCents - base * count;

  const amounts = new Array(count).fill(base / 100);
  amounts[count - 1] = (base + remainder) / 100;
  return amounts;
}

/**
 * Soma `months` a uma data `YYYY-MM-DD`. Segue o rollover padrão do
 * JS Date (ex.: 31/jan + 1 mês vira 02/03 ou 03/03, conforme o mês seguinte
 * tenha menos dias) — comportamento aceitável para vencimentos mensais.
 */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m - 1) + months, d));
  return dt.toISOString().slice(0, 10);
}
