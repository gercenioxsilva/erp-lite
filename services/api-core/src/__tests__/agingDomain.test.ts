import { describe, it, expect } from 'vitest';
import { buildAging, bucketOf, type AgingItemInput } from '../domain/aging/agingDomain';

function item(days: number, remaining: number, id = `x${days}`): AgingItemInput {
  return { id, party_name: 'Fulano', description: 'Título', due_date: '2025-01-10', remaining, days_overdue: days };
}

describe('bucketOf', () => {
  it('classifica a vencer quando days_overdue <= 0', () => {
    expect(bucketOf(-5)).toBe('not_due');
    expect(bucketOf(0)).toBe('not_due');
  });
  it('classifica as faixas de atraso', () => {
    expect(bucketOf(1)).toBe('d1_30');
    expect(bucketOf(30)).toBe('d1_30');
    expect(bucketOf(31)).toBe('d31_60');
    expect(bucketOf(60)).toBe('d31_60');
    expect(bucketOf(61)).toBe('d61_90');
    expect(bucketOf(90)).toBe('d61_90');
    expect(bucketOf(91)).toBe('d90_plus');
    expect(bucketOf(400)).toBe('d90_plus');
  });
});

describe('buildAging', () => {
  it('agrupa e totaliza por faixa', () => {
    const res = buildAging('receivable', '2025-02-01', [
      item(-3, 100), item(10, 200), item(45, 300), item(75, 400), item(120, 500),
    ]);
    const byKey = Object.fromEntries(res.buckets.map(b => [b.key, b]));
    expect(byKey.not_due.total).toBe(100);
    expect(byKey.d1_30.total).toBe(200);
    expect(byKey.d31_60.total).toBe(300);
    expect(byKey.d61_90.total).toBe(400);
    expect(byKey.d90_plus.total).toBe(500);
    expect(res.total).toBe(1500);
    expect(res.count).toBe(5);
  });

  it('mantém a ordem das faixas e conta itens por faixa', () => {
    const res = buildAging('payable', '2025-02-01', [item(5, 10, 'a'), item(6, 20, 'b'), item(200, 30, 'c')]);
    expect(res.buckets.map(b => b.key)).toEqual(['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
    expect(res.buckets.find(b => b.key === 'd1_30')!.count).toBe(2);
    expect(res.buckets.find(b => b.key === 'd90_plus')!.count).toBe(1);
    expect(res.type).toBe('payable');
    expect(res.as_of).toBe('2025-02-01');
  });

  it('anexa a faixa a cada item', () => {
    const res = buildAging('receivable', '2025-02-01', [item(45, 300, 'z')]);
    expect(res.items[0].bucket).toBe('d31_60');
  });
});
