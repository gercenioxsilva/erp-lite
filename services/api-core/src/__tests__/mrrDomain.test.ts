import { describe, it, expect } from 'vitest';
import { buildMrr, monthlyEquivalent, type ContractInput } from '../domain/mrr/mrrDomain';

describe('monthlyEquivalent', () => {
  it('normaliza cada frequencia para equivalente mensal', () => {
    expect(monthlyEquivalent(1200, 'annual')).toBe(100);
    expect(monthlyEquivalent(300, 'quarterly')).toBe(100);
    expect(monthlyEquivalent(600, 'semiannual')).toBe(100);
    expect(monthlyEquivalent(100, 'monthly')).toBe(100);
  });

  it('frequencia desconhecida cai no fallback mensal', () => {
    expect(monthlyEquivalent(150, 'biweekly')).toBe(150);
  });
});

describe('buildMrr', () => {
  const c = (amount: number, freq: string, id = 'c'): ContractInput => ({ id, amount, billing_frequency: freq });

  it('soma o mrr_total de contratos com frequencias mistas', () => {
    const res = buildMrr('2025-06-01', [c(100, 'monthly', 'a'), c(1200, 'annual', 'b')], [], []);
    expect(res.mrr_total).toBe(200); // 100 + (1200/12)
    expect(res.active_contracts).toBe(2);
  });

  it('agrupa by_frequency corretamente', () => {
    const res = buildMrr('2025-06-01', [c(100, 'monthly', 'a'), c(200, 'monthly', 'b'), c(1200, 'annual', 'c')], [], []);
    const byFreq = Object.fromEntries(res.by_frequency.map(f => [f.frequency, f]));
    expect(byFreq.monthly.count).toBe(2);
    expect(byFreq.monthly.mrr).toBe(300);
    expect(byFreq.annual.count).toBe(1);
    expect(byFreq.annual.mrr).toBe(100);
  });

  it('conta e soma novos e encerrados no periodo', () => {
    const res = buildMrr('2025-06-01', [], [c(100, 'monthly', 'novo')], [c(1200, 'annual', 'churn')]);
    expect(res.new_in_period).toEqual({ count: 1, mrr: 100 });
    expect(res.churned_in_period).toEqual({ count: 1, mrr: 100 });
  });

  it('lista vazia retorna mrr_total=0 sem crash', () => {
    const res = buildMrr('2025-06-01', [], [], []);
    expect(res.mrr_total).toBe(0);
    expect(res.active_contracts).toBe(0);
    expect(res.by_frequency).toEqual([]);
  });
});
