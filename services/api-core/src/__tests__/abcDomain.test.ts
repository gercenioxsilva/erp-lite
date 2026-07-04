import { describe, it, expect } from 'vitest';
import { buildAbcCurve, type AbcItemInput } from '../domain/abc/abcDomain';

function item(revenue: number, margin: number, name = 'p'): AbcItemInput {
  return { name, sku: null, quantity: 1, revenue, margin };
}

describe('buildAbcCurve', () => {
  it('classifica um item dominante como A e o resto como B/C', () => {
    const res = buildAbcCurve([item(8000, 0, 'lider'), item(1200, 0, 'mediano'), item(400, 0, 'cauda'), item(400, 0, 'cauda2')], 'revenue');
    expect(res.items[0].name).toBe('lider');
    expect(res.items[0].class).toBe('A');
    expect(res.summary.grand_total).toBe(10000);
  });

  it('retorna vazio quando grand_total <= 0 (sem crash de divisao por zero)', () => {
    const res = buildAbcCurve([], 'revenue');
    expect(res.items).toEqual([]);
    expect(res.summary.grand_total).toBe(0);

    const resNeg = buildAbcCurve([item(-5, -5)], 'revenue');
    expect(resNeg.items).toEqual([]);
  });

  it('usa o campo margin quando metric=margin', () => {
    const res = buildAbcCurve([item(1000, 100, 'a'), item(100, 900, 'b')], 'margin');
    expect(res.items[0].name).toBe('b'); // maior margem vem primeiro
    expect(res.items[0].value).toBe(900);
  });

  it('cumulative_pct e monotonicamente crescente e rank e sequencial', () => {
    const res = buildAbcCurve([item(500, 0, 'a'), item(300, 0, 'b'), item(200, 0, 'c')], 'revenue');
    expect(res.items.map(i => i.rank)).toEqual([1, 2, 3]);
    for (let i = 1; i < res.items.length; i++) {
      expect(res.items[i].cumulative_pct).toBeGreaterThanOrEqual(res.items[i - 1].cumulative_pct);
    }
    expect(res.items[res.items.length - 1].cumulative_pct).toBe(100);
  });
});
