// Domínio da Posição de Estoque — classificação pura (sem I/O) de saldo vs.
// mínimo/máximo cadastrado. O service faz a query; esta função só classifica e totaliza.

export type StockStatus = 'critical' | 'low' | 'ok' | 'excess';

export interface StockItemInput {
  id: string; name: string; sku: string | null; category: string | null;
  quantity: number; min_qty: number; max_qty: number | null;
  sale_price: number; cost_price: number;
}

export interface StockItem extends StockItemInput {
  status: StockStatus;
  stock_value: number;
}

export interface StockPositionResult {
  items: StockItem[];
  summary: {
    total_items: number;
    critical_count: number;
    low_count: number;
    excess_count: number;
    total_stock_value: number;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function classifyStockStatus(quantity: number, minQty: number, maxQty: number | null): StockStatus {
  if (quantity <= 0) return 'critical';
  if (quantity <= minQty) return 'low';
  if (maxQty != null && maxQty > 0 && quantity > maxQty) return 'excess';
  return 'ok';
}

const STATUS_ORDER: Record<StockStatus, number> = { critical: 0, low: 1, excess: 2, ok: 3 };

export function buildStockPosition(input: StockItemInput[]): StockPositionResult {
  const items: StockItem[] = input.map(i => ({
    ...i,
    status: classifyStockStatus(i.quantity, i.min_qty, i.max_qty),
    stock_value: round2(i.quantity * i.cost_price),
  }));

  items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.quantity - b.quantity);

  return {
    items,
    summary: {
      total_items:       items.length,
      critical_count:    items.filter(i => i.status === 'critical').length,
      low_count:         items.filter(i => i.status === 'low').length,
      excess_count:      items.filter(i => i.status === 'excess').length,
      total_stock_value: round2(items.reduce((s, i) => s + i.stock_value, 0)),
    },
  };
}
