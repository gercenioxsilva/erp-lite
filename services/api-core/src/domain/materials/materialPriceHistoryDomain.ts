// Comparação pura de preço — sem I/O, reaproveitada tanto pela importação em
// massa (routes/materials.ts POST /materials/import) quanto pela edição
// individual (PATCH /materials/:id), garantindo que os dois caminhos
// classificam "mudou/não mudou" exatamente da mesma forma (mesmo racional de
// taxEngine.ts ser puro e usado por mais de um chamador).

export interface MaterialPriceSnapshot {
  sale_price: number;
  cost_price: number;
}

// `undefined` = campo não informado nesta edição/linha — nunca conta como
// mudança. `null` não é um valor válido de preço; o chamador deve normalizar
// antes de chegar aqui.
export interface MaterialPriceInput {
  sale_price?: number;
  cost_price?: number;
}

export interface PriceFieldDiff {
  changed: boolean;
  before?: number;
  after?: number;
}

export interface MaterialPriceDiff {
  sale_price: PriceFieldDiff;
  cost_price: PriceFieldDiff;
  hasChanges: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function diffField(current: number, incoming: number | undefined): PriceFieldDiff {
  if (incoming === undefined) return { changed: false };
  const before = round2(current);
  const after = round2(incoming);
  if (before === after) return { changed: false };
  return { changed: true, before, after };
}

export function diffMaterialPrice(current: MaterialPriceSnapshot, incoming: MaterialPriceInput): MaterialPriceDiff {
  const sale_price = diffField(current.sale_price, incoming.sale_price);
  const cost_price = diffField(current.cost_price, incoming.cost_price);
  return { sale_price, cost_price, hasChanges: sale_price.changed || cost_price.changed };
}
