// Domínio de Pedido de Compra — regras de negócio puras, sem I/O.
// Segue o padrão de Clean Architecture: esta camada não conhece Fastify, Drizzle
// nem qualquer detalhe de infraestrutura. Testável de forma isolada.

export type POStatus = 'draft' | 'approved' | 'received' | 'cancelled';

export interface PurchaseOrderState {
  status: POStatus;
}

// ── State machine ─────────────────────────────────────────────────────────────
// draft → approved → received | cancelled
// draft → cancelled
// Transições não listadas são proibidas.

const VALID_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft:     ['approved', 'cancelled'],
  approved:  ['received', 'cancelled'],
  received:  [],   // terminal
  cancelled: [],   // terminal
};

export class PurchaseOrderDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'PurchaseOrderDomainError';
  }
}

export function assertTransition(from: POStatus, to: POStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new PurchaseOrderDomainError('invalid_po_transition', {
      from, to, allowed: VALID_TRANSITIONS[from],
    });
  }
}

// ── Cálculo de totais ─────────────────────────────────────────────────────────

export interface POItemInput {
  quantity:   number;
  unit_price: number;
}

export function calcPOTotals(
  items:    POItemInput[],
  discount: number,
  shipping: number,
): { subtotal: number; total: number } {
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  return {
    subtotal: round2(subtotal),
    total:    round2(Math.max(0, subtotal - discount + shipping)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Validações de criação ─────────────────────────────────────────────────────

export interface POCreateInput {
  items: POItemInput[];
}

export function validatePOCreate(input: POCreateInput): void {
  if (!input.items.length) {
    throw new PurchaseOrderDomainError('po_no_items');
  }
  for (const it of input.items) {
    if (it.quantity <= 0) throw new PurchaseOrderDomainError('po_item_quantity_zero');
    if (it.unit_price < 0) throw new PurchaseOrderDomainError('po_item_price_negative');
  }
}
