import { describe, it, expect } from 'vitest';
import { calcTotals } from '../routes/orders';

describe('calcTotals', () => {
  it('calculates subtotal from items', () => {
    const items = [
      { name: 'A', quantity: 2, unit_price: 10 },
      { name: 'B', quantity: 3, unit_price: 5 },
    ];
    const { subtotal, total } = calcTotals(items);
    expect(subtotal).toBe(35);
    expect(total).toBe(35);
  });

  it('subtracts discount from total', () => {
    const items = [{ name: 'A', quantity: 1, unit_price: 100 }];
    const { subtotal, total } = calcTotals(items, 10, 0);
    expect(subtotal).toBe(100);
    expect(total).toBe(90);
  });

  it('adds shipping to total', () => {
    const items = [{ name: 'A', quantity: 1, unit_price: 100 }];
    const { total } = calcTotals(items, 0, 15);
    expect(total).toBe(115);
  });

  it('handles discount and shipping together', () => {
    const items = [{ name: 'A', quantity: 2, unit_price: 50 }];
    const { subtotal, total } = calcTotals(items, 20, 5);
    expect(subtotal).toBe(100);
    expect(total).toBe(85);
  });

  it('returns zero totals for empty items', () => {
    const { subtotal, total } = calcTotals([]);
    expect(subtotal).toBe(0);
    expect(total).toBe(0);
  });

  it('handles string-coerced quantities and prices', () => {
    const items = [{ name: 'A', quantity: '3' as any, unit_price: '7.5' as any }];
    const { subtotal } = calcTotals(items);
    expect(subtotal).toBe(22.5);
  });
});
