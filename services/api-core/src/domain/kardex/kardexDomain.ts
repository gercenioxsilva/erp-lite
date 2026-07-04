// Domínio do Kardex — agregação pura (sem I/O) de movimentações de estoque.
//
// inventory_movements.quantity já vem com sinal (positivo = entrada, negativo =
// saída, conforme comentário da migration 0004). 'adjustment'/'transfer' entram
// no saldo líquido mas não são contados como entrada/saída "de negócio" (compra
// vs. venda) — só afetam `net`, não `total_in`/`total_out`.

export type MovementType = 'in' | 'out' | 'adjustment' | 'return' | 'transfer';

export interface MovementInput {
  movement_type: MovementType;
  quantity: number;
}

export interface KardexSummary {
  total_in: number;
  total_out: number;
  net: number;
  movement_count: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildKardexSummary(movements: MovementInput[]): KardexSummary {
  const total_in = movements
    .filter(m => m.movement_type === 'in' || m.movement_type === 'return')
    .reduce((s, m) => s + Math.abs(m.quantity), 0);

  const total_out = movements
    .filter(m => m.movement_type === 'out')
    .reduce((s, m) => s + Math.abs(m.quantity), 0);

  const net = movements.reduce((s, m) => s + m.quantity, 0);

  return {
    total_in:  round2(total_in),
    total_out: round2(total_out),
    net:       round2(net),
    movement_count: movements.length,
  };
}
