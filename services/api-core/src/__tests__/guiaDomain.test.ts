// E8: builder puro da guia de impostos — passos, valores e vencimento com
// dia útil (feriado inclusive, ver holidays). Sem side effect.

import { describe, it, expect } from 'vitest';
import { buildGuia, buildRoteiroPassos, ApuracaoRowLike } from '../domain/fiscal/guiaDomain';

const ROW: ApuracaoRowLike = {
  competencia: '2026-06',
  rbt12: '300000.00', receita_competencia: '25000.00', das_total: '4040.00',
  fator_r: '0.3200', sublimite_excedido: false,
  valor_irpj: '218.16', valor_csll: '196.75', valor_cofins: '606.00', valor_pis: '131.30',
  valor_cpp: '1595.00', valor_icms: '0', valor_ipi: '0', valor_iss: '1292.80',
  iss_retido: '0',
  memoria: { porAnexo: [] },
};

describe('buildRoteiroPassos', () => {
  it('gera 6 passos citando competência e receita', () => {
    const passos = buildRoteiroPassos('2026-06', '25000.00');
    expect(passos).toHaveLength(6);
    expect(passos[1]).toContain('2026-06');
    expect(passos[2]).toContain('25000.00');
  });
});

describe('buildGuia', () => {
  it('monta valores, tributos e vencimento (dia 20 útil de julho/2026 = segunda)', () => {
    const g = buildGuia(ROW);
    expect(g.competencia).toBe('2026-06');
    expect(g.vencimento).toBe('2026-07-20'); // 20/07/2026 é segunda
    expect(g.valores.das_total).toBe('4040.00');
    expect(g.valores.tributos.iss).toBe('1292.80');
    expect(g.passos).toHaveLength(6);
    expect(g.aviso).toContain('não a guia oficial');
    expect(g.memoria).toEqual({ porAnexo: [] });
  });

  it('vencimento pula fim de semana: competência 05/2026 → 20/06 é sábado → 22/06', () => {
    expect(buildGuia({ ...ROW, competencia: '2026-05' }).vencimento).toBe('2026-06-22');
  });
});
