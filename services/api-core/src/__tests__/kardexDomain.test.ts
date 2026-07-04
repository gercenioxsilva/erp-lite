import { describe, it, expect } from 'vitest';
import { buildKardexSummary, type MovementInput } from '../domain/kardex/kardexDomain';

describe('buildKardexSummary', () => {
  it('soma entradas (in/return) e saidas (out) separadamente', () => {
    const movements: MovementInput[] = [
      { movement_type: 'in',  quantity: 100 },
      { movement_type: 'return', quantity: 5 },
      { movement_type: 'out', quantity: -30 },
      { movement_type: 'out', quantity: -20 },
    ];
    const res = buildKardexSummary(movements);
    expect(res.total_in).toBe(105);
    expect(res.total_out).toBe(50);
    expect(res.movement_count).toBe(4);
  });

  it('net respeita os sinais de todas as movimentacoes, incluindo adjustment/transfer', () => {
    const movements: MovementInput[] = [
      { movement_type: 'in',  quantity: 100 },
      { movement_type: 'out', quantity: -40 },
      { movement_type: 'adjustment', quantity: -5 },
      { movement_type: 'transfer', quantity: 2 },
    ];
    const res = buildKardexSummary(movements);
    expect(res.net).toBe(100 - 40 - 5 + 2);
  });

  it('adjustment e transfer nao contam para total_in/total_out', () => {
    const res = buildKardexSummary([{ movement_type: 'adjustment', quantity: 50 }, { movement_type: 'transfer', quantity: -10 }]);
    expect(res.total_in).toBe(0);
    expect(res.total_out).toBe(0);
    expect(res.net).toBe(40);
  });

  it('lista vazia retorna zeros', () => {
    const res = buildKardexSummary([]);
    expect(res).toEqual({ total_in: 0, total_out: 0, net: 0, movement_count: 0 });
  });
});
