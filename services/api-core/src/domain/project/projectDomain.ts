// Domínio de Projeto — regras de negócio puras, sem I/O. Mesmo padrão de
// Clean Architecture já usado em serviceOrderDomain.ts/purchaseOrderDomain.ts:
// esta camada não conhece Fastify, Drizzle nem qualquer detalhe de
// infraestrutura. Testável de forma isolada.

export type ProjectStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';
export type ProfessionalType = 'technician' | 'seller';

export class ProjectDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'ProjectDomainError';
  }
}

// ── State machine ─────────────────────────────────────────────────────────────
// draft → in_progress → completed | cancelled
// draft → cancelled

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft:       ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   [], // terminal
  cancelled:   [], // terminal
};

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new ProjectDomainError('invalid_project_transition', { from, to, allowed: VALID_TRANSITIONS[from] });
  }
}

// Um projeto só é editável em 'draft' — mesmo princípio de OS/Pedido de
// Compra: depois de iniciado, profissionais/vínculos/status ainda mudam,
// mas os dados-base (nome, valor, datas) ficam congelados.
export function assertProjectEditable(status: ProjectStatus): void {
  if (status !== 'draft') {
    throw new ProjectDomainError('project_not_editable', { status });
  }
}

// ── Validações de criação/edição ────────────────────────────────────────────────

export interface ProjectCreateInput {
  name: string;
  total_value: number;
}

export function validateProjectCreate(input: ProjectCreateInput): void {
  if (!input.name?.trim()) throw new ProjectDomainError('project_name_required');
  if (!(input.total_value >= 0)) throw new ProjectDomainError('project_total_value_invalid');
}

export interface ProfessionalAllocationInput {
  professional_type: ProfessionalType;
  technician_id?: string | null;
  seller_id?: string | null;
  commission_pct: number;
}

const VALID_PROFESSIONAL_TYPES: ProfessionalType[] = ['technician', 'seller'];

export function validateProfessionalAllocation(input: ProfessionalAllocationInput): void {
  if (!VALID_PROFESSIONAL_TYPES.includes(input.professional_type)) {
    throw new ProjectDomainError('project_professional_invalid_type', { type: input.professional_type });
  }
  if (input.professional_type === 'technician') {
    if (!input.technician_id) throw new ProjectDomainError('project_professional_technician_required');
    if (input.seller_id) throw new ProjectDomainError('project_professional_conflicting_ids');
  } else {
    if (!input.seller_id) throw new ProjectDomainError('project_professional_seller_required');
    if (input.technician_id) throw new ProjectDomainError('project_professional_conflicting_ids');
  }
  if (!(input.commission_pct >= 0 && input.commission_pct <= 100)) {
    throw new ProjectDomainError('project_professional_commission_invalid');
  }
}

// ── Relatório de acompanhamento ─────────────────────────────────────────────────
// Cálculo puro a partir de números já agregados (SUMs) trazidos pelo serviço
// — esta função nunca faz I/O, só aritmética. "Consumido" é o valor de
// pedidos+OS vinculados ao projeto (o que já foi comprometido/vendido dentro
// do projeto); "faturado" é a fração disso que já virou nota/recebível de
// verdade (invoices para pedidos, receivables para OS — regra 47/48: OS
// nunca fatura via invoices, sempre via receivables.service_order_id).

export interface ProjectReportInput {
  total_value:             number;
  ordersTotal:              number;
  ordersInvoicedTotal:      number;
  serviceOrdersTotal:       number;
  serviceOrdersBilledTotal: number;
}

export interface ProjectReportResult {
  goodsServicesConsumed: number;
  goodsServicesInvoiced: number;
  budgetConsumedPct:     number;
  budgetInvoicedPct:     number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calcProjectReport(input: ProjectReportInput): ProjectReportResult {
  const goodsServicesConsumed = round2(input.ordersTotal + input.serviceOrdersTotal);
  const goodsServicesInvoiced = round2(input.ordersInvoicedTotal + input.serviceOrdersBilledTotal);
  const hasBudget = input.total_value > 0;
  return {
    goodsServicesConsumed,
    goodsServicesInvoiced,
    budgetConsumedPct: hasBudget ? round2((goodsServicesConsumed / input.total_value) * 100) : 0,
    budgetInvoicedPct: hasBudget ? round2((goodsServicesInvoiced / input.total_value) * 100) : 0,
  };
}
