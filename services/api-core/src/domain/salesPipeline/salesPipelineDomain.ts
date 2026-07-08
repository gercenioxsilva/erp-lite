// Domínio do Funil de Vendas (CRM) — regras de negócio puras, sem I/O.
// Segue o mesmo padrão de Clean Architecture já usado em
// serviceOrderDomain.ts/simplesRemessaDomain.ts: esta camada não conhece
// Fastify, Drizzle nem qualquer detalhe de infraestrutura.

export type OpportunityStatus = 'open' | 'won' | 'lost';

export class SalesPipelineDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'SalesPipelineDomainError';
  }
}

// ── Ganho/Perdido: transição só a partir de 'open' ────────────────────────────
// Ganho/Perdido são estados terminais — uma oportunidade já fechada nunca
// reabre nem troca de resultado (mesmo espírito de invoices.status='issued'
// nunca voltar a 'draft'). Reabrir uma negociação perdida é, no mundo real,
// uma nova oportunidade — não um "desfazer".

export function assertCanMarkWon(status: OpportunityStatus): void {
  if (status !== 'open') {
    throw new SalesPipelineDomainError('opportunity_not_open', { status });
  }
}

export function assertCanMarkLost(status: OpportunityStatus): void {
  if (status !== 'open') {
    throw new SalesPipelineDomainError('opportunity_not_open', { status });
  }
}

// ── Validações de criação/edição ──────────────────────────────────────────────

export function validateOpportunityValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new SalesPipelineDomainError('opportunity_value_invalid', { value });
  }
}

export function validateOpportunityTitle(title: string): void {
  if (!title?.trim()) {
    throw new SalesPipelineDomainError('opportunity_title_required');
  }
}

// ── Etapas padrão (seed) ──────────────────────────────────────────────────────
// Semeadas automaticamente na primeira leitura de um tenant sem nenhuma etapa
// cadastrada — nunca inclui Ganho/Perdido, que são o `status` da oportunidade,
// não uma linha desta lista (ver services/salesPipelineService.ts).

export const DEFAULT_STAGES = ['Novo Lead', 'Qualificação', 'Proposta Enviada', 'Negociação'] as const;

export type ActivityType = 'note' | 'call' | 'meeting' | 'stage_change' | 'won' | 'lost' | 'proposal_linked';

export const MANUAL_ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'meeting'];

export function isManualActivityType(type: string): type is 'note' | 'call' | 'meeting' {
  return (MANUAL_ACTIVITY_TYPES as string[]).includes(type);
}
