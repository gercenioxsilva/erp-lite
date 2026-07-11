// Consolidação — regras PURAS. grouping_key é DETERMINÍSTICO: a mesma venda
// sob a mesma regra produz sempre a mesma chave (UNIQUE tenant+grouping_key
// torna o reprocesso idempotente). Sub-agrupamento por service_code embutido
// na chave (LC116 heterogêneo nunca vira 1 nota).

export class ConsolidationDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ConsolidationDomainError';
  }
}

export const STRATEGIES = ['per_sale', 'daily', 'weekly', 'monthly', 'per_client', 'per_contract'] as const;
export type Strategy = typeof STRATEGIES[number];

export interface SaleForGrouping {
  transactionId: string;
  companyId:     string;
  clientId?:     string | null;
  contractId?:   string | null;
  saleDate:      Date;          // occurred_at da transação conciliada
  serviceCode:   string;        // resolvido: regra > cadastro default da empresa
}

/** Competência 'YYYY-MM' da venda (local). */
export function competencyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Segunda-feira ISO da semana da data — âncora estável p/ strategy weekly. */
export function weekAnchor(d: Date): string {
  const monday = new Date(d);
  const day = (d.getDay() + 6) % 7; // 0=segunda
  monday.setDate(d.getDate() - day);
  return monday.toISOString().slice(0, 10);
}

/**
 * Chave determinística por cadência. Sempre inclui company + service_code;
 * per_sale inclui a própria transação (1 nota por venda).
 */
export function computeGroupingKey(strategy: Strategy, sale: SaleForGrouping): string {
  const base = `c:${sale.companyId}:s:${sale.serviceCode}`;
  const day = sale.saleDate.toISOString().slice(0, 10);
  switch (strategy) {
    case 'per_sale':     return `${base}:tx:${sale.transactionId}`;
    case 'daily':        return `${base}:d:${day}`;
    case 'weekly':       return `${base}:w:${weekAnchor(sale.saleDate)}`;
    case 'monthly':      return `${base}:m:${competencyOf(sale.saleDate)}`;
    case 'per_client':   return `${base}:m:${competencyOf(sale.saleDate)}:cl:${sale.clientId ?? 'none'}`;
    case 'per_contract': return `${base}:m:${competencyOf(sale.saleDate)}:ct:${sale.contractId ?? 'none'}`;
    default:             throw new ConsolidationDomainError('invalid_strategy', { strategy });
  }
}

export interface RuleForResolution {
  id: string;
  companyId: string;
  clientId: string | null;
  contractId: string | null;
  strategy: Strategy;
  serviceCode: string | null;
}

/** Especificidade: contrato > cliente > empresa (molde resolveCompanyId). */
export function resolveRule(rules: RuleForResolution[], sale: { companyId: string; clientId?: string | null; contractId?: string | null }): RuleForResolution | null {
  const forCompany = rules.filter((r) => r.companyId === sale.companyId);
  return forCompany.find((r) => r.contractId && r.contractId === sale.contractId)
    ?? forCompany.find((r) => r.clientId && r.clientId === sale.clientId)
    ?? forCompany.find((r) => !r.clientId && !r.contractId)
    ?? null;
}
