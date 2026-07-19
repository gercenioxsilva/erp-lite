// Motor Simples puro (0070): MEI bloqueado, Fator R (trava com folha
// incompleta), RBT12 com início de atividade e sublimite.

import { describe, it, expect } from 'vitest';
import {
  assertApuravelPorPercentual, resolveAnexoByFatorR, computeRbt12,
  windowCompetencias, mesesDeAtividadeAntes, exigeIcmsIssPorFora, SimplesDomainError,
} from '../domain/simples/simplesDomain';

describe('assertApuravelPorPercentual (MEI)', () => {
  it('bloqueia MEI explicitamente (DAS-SIMEI fixo)', () => {
    try { assertApuravelPorPercentual('MEI'); expect.unreachable(); }
    catch (e: any) { expect(e).toBeInstanceOf(SimplesDomainError); expect(e.code).toBe('mei_das_fixo_nao_suportado'); }
  });
  it('ME/EPP passam', () => {
    expect(() => assertApuravelPorPercentual('ME')).not.toThrow();
    expect(() => assertApuravelPorPercentual('EPP')).not.toThrow();
  });
});

describe('resolveAnexoByFatorR', () => {
  it('>= 28% → Anexo III; < 28% → Anexo V', () => {
    expect(resolveAnexoByFatorR({ folha12m: 28_000, receita12m: 100_000, mesesComFolha: 12 }))
      .toEqual({ fatorR: 0.28, anexo: 'III' });
    expect(resolveAnexoByFatorR({ folha12m: 27_999, receita12m: 100_000, mesesComFolha: 12 }).anexo).toBe('V');
  });
  it('TRAVA com folha incompleta em vez de assumir 0 (evita Anexo V indevido)', () => {
    try { resolveAnexoByFatorR({ folha12m: 10_000, receita12m: 100_000, mesesComFolha: 7 }); expect.unreachable(); }
    catch (e: any) { expect(e.code).toBe('folha_12m_incompleta'); expect(e.payload.mesesComFolha).toBe(7); }
  });
});

describe('windowCompetencias / mesesDeAtividadeAntes', () => {
  it('gera as 12 competências anteriores atravessando o ano', () => {
    const w = windowCompetencias('2026-02');
    expect(w[0]).toBe('2026-01');
    expect(w[1]).toBe('2025-12');
    expect(w).toHaveLength(12);
    expect(w[11]).toBe('2025-02');
  });
  it('meses de atividade limita em 12 e rejeita competência anterior à abertura', () => {
    expect(mesesDeAtividadeAntes('2026-07', '2026-03-15')).toBe(4);
    expect(mesesDeAtividadeAntes('2026-07', '2020-01-01')).toBe(12);
    expect(mesesDeAtividadeAntes('2026-07', null)).toBeNull();
    expect(() => mesesDeAtividadeAntes('2026-07', '2026-09-01')).toThrowError(SimplesDomainError);
  });
});

describe('computeRbt12 — início de atividade (LC123 art.18 §§1-2)', () => {
  it('empresa madura: soma simples da janela', () => {
    const receitas: Record<string, number> = {};
    for (const c of windowCompetencias('2026-07')) receitas[c] = 10_000;
    expect(computeRbt12({ receitasPorCompetencia: receitas, competencia: '2026-07', dataAbertura: '2020-01-01' }))
      .toBe(120_000);
  });

  it('1º mês de atividade: receita do próprio mês × 12', () => {
    expect(computeRbt12({
      receitasPorCompetencia: { '2026-07': 15_000 }, competencia: '2026-07', dataAbertura: '2026-07-05',
    })).toBe(180_000);
  });

  it('<12 meses: média dos meses de atividade × 12 (proporcionalização)', () => {
    // Abertura 2026-03 → 4 meses completos antes de 2026-07 (mar,abr,mai,jun).
    const receitas = { '2026-06': 20_000, '2026-05': 10_000, '2026-04': 10_000, '2026-03': 0 };
    // média = 40000/4 = 10000 → RBT12 = 120000 (e NÃO 40000, que cairia na faixa errada)
    expect(computeRbt12({ receitasPorCompetencia: receitas, competencia: '2026-07', dataAbertura: '2026-03-10' }))
      .toBe(120_000);
  });

  it('sem data de abertura assume empresa madura (janela cheia)', () => {
    const receitas = { '2026-06': 50_000 };
    expect(computeRbt12({ receitasPorCompetencia: receitas, competencia: '2026-07', dataAbertura: null }))
      .toBe(50_000);
  });
});

describe('sublimite ICMS/ISS (R$3,6M)', () => {
  it('acima do sublimite exige ICMS/ISS por fora do DAS', () => {
    expect(exigeIcmsIssPorFora(3_600_000)).toBe(false);
    expect(exigeIcmsIssPorFora(3_600_000.01)).toBe(true);
  });
});
