// Domínio de Ordem de Serviço — regras de negócio puras, sem I/O.
// Segue o padrão de Clean Architecture já usado em purchaseOrderDomain.ts:
// esta camada não conhece Fastify, Drizzle nem qualquer detalhe de
// infraestrutura. Testável de forma isolada.

export type ServiceOrderStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type ServiceOrderType   = 'installation' | 'maintenance' | 'repair' | 'inspection';

// ── State machine ─────────────────────────────────────────────────────────────
// draft → scheduled → in_progress → completed | cancelled
// draft → cancelled
// scheduled → cancelled
// Transições não listadas são proibidas.

const VALID_TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  draft:       ['scheduled', 'cancelled'],
  scheduled:   ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [], // terminal
  cancelled:   [], // terminal
};

export class ServiceOrderDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'ServiceOrderDomainError';
  }
}

export function assertServiceOrderTransition(from: ServiceOrderStatus, to: ServiceOrderStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new ServiceOrderDomainError('invalid_service_order_transition', {
      from, to, allowed: VALID_TRANSITIONS[from],
    });
  }
}

// ── Cálculo de totais ─────────────────────────────────────────────────────────

export interface ServiceOrderItemInput {
  quantity:   number;
  unit_price: number;
}

export function calcServiceOrderTotals(items: ServiceOrderItemInput[]): { subtotal: number; total: number } {
  const subtotal = round2(items.reduce((s, it) => s + it.quantity * it.unit_price, 0));
  return { subtotal, total: subtotal };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Validações de criação ─────────────────────────────────────────────────────

export interface ServiceOrderCreateInput {
  title: string;
  type:  ServiceOrderType;
  items?: ServiceOrderItemInput[];
}

const VALID_TYPES: ServiceOrderType[] = ['installation', 'maintenance', 'repair', 'inspection'];

export function validateServiceOrderCreate(input: ServiceOrderCreateInput): void {
  if (!input.title?.trim()) throw new ServiceOrderDomainError('service_order_title_required');
  if (!VALID_TYPES.includes(input.type)) {
    throw new ServiceOrderDomainError('service_order_invalid_type', { type: input.type, allowed: VALID_TYPES });
  }
  for (const it of input.items ?? []) {
    if (it.quantity <= 0) throw new ServiceOrderDomainError('service_order_item_quantity_zero');
    if (it.unit_price < 0) throw new ServiceOrderDomainError('service_order_item_price_negative');
  }
}

// Uma OS só fecha quando todas as suas visitas estiverem em estado terminal.
export function canCompleteServiceOrder(visitStatuses: string[]): boolean {
  if (!visitStatuses.length) return false;
  const TERMINAL = new Set(['completed', 'cancelled', 'no_show']);
  return visitStatuses.every(s => TERMINAL.has(s));
}
