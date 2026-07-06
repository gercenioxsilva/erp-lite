import { describe, it, expect } from 'vitest';
import { diffMaterialPrice } from '../domain/materials/materialPriceHistoryDomain';

const CURRENT = { sale_price: 29.9, cost_price: 15.0 };

describe('diffMaterialPrice', () => {
  it('reports no changes when neither field is provided', () => {
    const diff = diffMaterialPrice(CURRENT, {});
    expect(diff.hasChanges).toBe(false);
    expect(diff.sale_price.changed).toBe(false);
    expect(diff.cost_price.changed).toBe(false);
  });

  it('reports no changes when provided values equal the current ones', () => {
    const diff = diffMaterialPrice(CURRENT, { sale_price: 29.9, cost_price: 15.0 });
    expect(diff.hasChanges).toBe(false);
  });

  it('detects a sale_price-only change', () => {
    const diff = diffMaterialPrice(CURRENT, { sale_price: 32.9 });
    expect(diff.hasChanges).toBe(true);
    expect(diff.sale_price).toEqual({ changed: true, before: 29.9, after: 32.9 });
    expect(diff.cost_price.changed).toBe(false);
  });

  it('detects a cost_price-only change', () => {
    const diff = diffMaterialPrice(CURRENT, { cost_price: 16.5 });
    expect(diff.hasChanges).toBe(true);
    expect(diff.cost_price).toEqual({ changed: true, before: 15.0, after: 16.5 });
    expect(diff.sale_price.changed).toBe(false);
  });

  it('detects both fields changing together', () => {
    const diff = diffMaterialPrice(CURRENT, { sale_price: 32.9, cost_price: 16.5 });
    expect(diff.hasChanges).toBe(true);
    expect(diff.sale_price.changed).toBe(true);
    expect(diff.cost_price.changed).toBe(true);
  });

  it('does not flag a change from floating-point rounding noise (rounds to 2 decimals first)', () => {
    const diff = diffMaterialPrice({ sale_price: 29.9, cost_price: 15.0 }, { sale_price: 29.900000001 });
    expect(diff.sale_price.changed).toBe(false);
  });

  it('ignores cost_price when only sale_price is provided (undefined never counts as a change)', () => {
    const diff = diffMaterialPrice(CURRENT, { sale_price: 32.9, cost_price: undefined });
    expect(diff.cost_price.changed).toBe(false);
    expect(diff.sale_price.changed).toBe(true);
  });
});
