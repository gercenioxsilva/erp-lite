import { describe, it, expect } from 'vitest';
import { buildStockPosition, classifyStockStatus, type StockItemInput } from '../domain/stockPosition/stockPositionDomain';

function item(overrides: Partial<StockItemInput>, id = 'x'): StockItemInput {
  return { id, name: 'Produto', sku: 'SKU1', category: null, quantity: 10, min_qty: 5, max_qty: null, sale_price: 20, cost_price: 10, ...overrides };
}

describe('classifyStockStatus', () => {
  it('classifica critical quando quantity <= 0', () => {
    expect(classifyStockStatus(0, 5, null)).toBe('critical');
    expect(classifyStockStatus(-2, 5, null)).toBe('critical');
  });
  it('classifica low quando quantity <= min_qty', () => {
    expect(classifyStockStatus(5, 5, null)).toBe('low');
    expect(classifyStockStatus(3, 5, null)).toBe('low');
  });
  it('classifica excess quando quantity > max_qty (max_qty definido e > 0)', () => {
    expect(classifyStockStatus(20, 5, 15)).toBe('excess');
  });
  it('nunca gera excess quando max_qty e null', () => {
    expect(classifyStockStatus(1000, 5, null)).toBe('ok');
  });
  it('classifica ok no caso normal', () => {
    expect(classifyStockStatus(10, 5, 20)).toBe('ok');
  });
});

describe('buildStockPosition', () => {
  it('classifica e soma o valor em estoque', () => {
    const res = buildStockPosition([
      item({ quantity: 0, cost_price: 10 }, 'a'),
      item({ quantity: 3, min_qty: 5, cost_price: 20 }, 'b'),
      item({ quantity: 10, min_qty: 5, max_qty: null, cost_price: 5 }, 'c'),
    ]);
    expect(res.summary.total_items).toBe(3);
    expect(res.summary.critical_count).toBe(1);
    expect(res.summary.low_count).toBe(1);
    expect(res.summary.total_stock_value).toBe(0 + 60 + 50);
  });

  it('ordena critical/low antes de ok/excess', () => {
    const res = buildStockPosition([
      item({ quantity: 100, min_qty: 5, max_qty: 50 }, 'excess-item'),
      item({ quantity: 10, min_qty: 5, max_qty: 50 }, 'ok-item'),
      item({ quantity: 0 }, 'critical-item'),
    ]);
    expect(res.items[0].id).toBe('critical-item');
  });
});
