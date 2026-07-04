// Domínio de Receita Recorrente (MRR) — normalização pura (sem I/O) de contratos
// para equivalente mensal. billing_frequency é texto livre no banco (sem CHECK
// constraint); os valores reais usados pela aplicação são 'monthly'/'quarterly'/
// 'semiannual'/'annual' (confirmado em routes/serviceContracts.ts). Frequências
// desconhecidas caem no fallback mensal (conservador: não infla nem reduz o MRR
// sem uma regra clara).

export type BillingFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';

const FREQUENCY_MONTHS: Record<BillingFrequency, number> = {
  monthly: 1, quarterly: 3, semiannual: 6, annual: 12,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function monthlyEquivalent(amount: number, frequency: string): number {
  const months = FREQUENCY_MONTHS[frequency as BillingFrequency] ?? 1;
  return round2(amount / months);
}

export interface ContractInput {
  id: string;
  amount: number;
  billing_frequency: string;
}

export interface MrrResult {
  as_of: string;
  mrr_total: number;
  active_contracts: number;
  by_frequency: { frequency: string; count: number; mrr: number }[];
  new_in_period: { count: number; mrr: number };
  churned_in_period: { count: number; mrr: number };
}

function sumMonthly(contracts: ContractInput[]): number {
  return round2(contracts.reduce((s, c) => s + monthlyEquivalent(c.amount, c.billing_frequency), 0));
}

export function buildMrr(
  asOf: string,
  activeContracts: ContractInput[],
  newContracts: ContractInput[],
  churnedContracts: ContractInput[],
): MrrResult {
  const byFrequency = new Map<string, ContractInput[]>();
  for (const c of activeContracts) {
    const list = byFrequency.get(c.billing_frequency) ?? [];
    list.push(c);
    byFrequency.set(c.billing_frequency, list);
  }

  return {
    as_of: asOf,
    mrr_total: sumMonthly(activeContracts),
    active_contracts: activeContracts.length,
    by_frequency: Array.from(byFrequency.entries()).map(([frequency, list]) => ({
      frequency, count: list.length, mrr: sumMonthly(list),
    })),
    new_in_period:     { count: newContracts.length,     mrr: sumMonthly(newContracts) },
    churned_in_period: { count: churnedContracts.length, mrr: sumMonthly(churnedContracts) },
  };
}
