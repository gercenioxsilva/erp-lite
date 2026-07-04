import { describe, it, expect } from 'vitest';
import { buildCashflow, type CashflowBucketInput } from '../domain/cashflow/cashflowDomain';

function rows(...bs: Partial<CashflowBucketInput>[]): CashflowBucketInput[] {
  return bs.map((b, i) => ({
    period: `2025-01-${String(i + 1).padStart(2, '0')}`,
    realized_inflow: 0, realized_outflow: 0, projected_inflow: 0, projected_outflow: 0,
    ...b,
  }));
}

describe('buildCashflow', () => {
  it('calcula net por bucket e saldo acumulado a partir da abertura', () => {
    const cf = buildCashflow('2025-01-01', '2025-01-31', 'month', 1000, rows(
      { realized_inflow: 500, realized_outflow: 200, projected_inflow: 100, projected_outflow: 50 },
    ));
    const b = cf.buckets[0];
    expect(b.realized_net).toBe(300);   // 500 - 200
    expect(b.projected_net).toBe(50);   // 100 - 50
    expect(b.net).toBe(350);            // 300 + 50
    expect(b.accumulated).toBe(1350);   // 1000 + 350
  });

  it('acumula saldo ao longo de múltiplos buckets', () => {
    const cf = buildCashflow('2025-01-01', '2025-03-31', 'month', 0, rows(
      { realized_inflow: 1000 },
      { realized_outflow: 400 },
      { projected_inflow: 200, projected_outflow: 100 },
    ));
    expect(cf.buckets[0].accumulated).toBe(1000);
    expect(cf.buckets[1].accumulated).toBe(600);  // 1000 - 400
    expect(cf.buckets[2].accumulated).toBe(700);  // 600 + 100
    expect(cf.summary.closing_balance).toBe(700);
  });

  it('totaliza o summary corretamente', () => {
    const cf = buildCashflow('2025-01-01', '2025-01-31', 'week', 0, rows(
      { realized_inflow: 100, projected_outflow: 30 },
      { realized_outflow: 40, projected_inflow: 20 },
    ));
    expect(cf.summary.total_realized_inflow).toBe(100);
    expect(cf.summary.total_realized_outflow).toBe(40);
    expect(cf.summary.total_projected_inflow).toBe(20);
    expect(cf.summary.total_projected_outflow).toBe(30);
    expect(cf.summary.realized_net).toBe(60);   // 100 - 40
    expect(cf.summary.projected_net).toBe(-10); // 20 - 30
    expect(cf.summary.net).toBe(50);
  });

  it('preserva período, granularidade e abertura', () => {
    const cf = buildCashflow('2025-02-01', '2025-02-28', 'month', 250, []);
    expect(cf.period_from).toBe('2025-02-01');
    expect(cf.period_to).toBe('2025-02-28');
    expect(cf.granularity).toBe('month');
    expect(cf.opening_balance).toBe(250);
    expect(cf.summary.closing_balance).toBe(250); // sem movimento
  });

  it('arredonda para 2 casas', () => {
    const cf = buildCashflow('2025-01-01', '2025-01-31', 'month', 0, rows(
      { realized_inflow: 10.005, realized_outflow: 0.001 },
    ));
    expect(cf.buckets[0].realized_inflow).toBe(10.01);
    expect(cf.buckets[0].realized_outflow).toBe(0);
  });
});
