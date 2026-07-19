// Apuração PGDAS-D (0075): valores oficiais LC123 verificáveis à mão,
// teto de 5% do ISS, sublimite (ICMS/ISS por fora), Anexo IV sem CPP e
// abatimento de ISS retido.

import { describe, it, expect } from 'vitest';
import { apurarSimples, BracketRow, ReparticaoRow } from '../domain/simples/apuracaoDomain';
import { SimplesDomainError } from '../domain/simples/simplesDomain';

// Anexo III oficial (seed 0070/0075).
const BRACKETS_III: BracketRow[] = [
  { faixa: 1, rbt12_min: 0, rbt12_max: 180000, aliquota_nominal: 6, parcela_deduzir: 0 },
  { faixa: 2, rbt12_min: 180000.01, rbt12_max: 360000, aliquota_nominal: 11.2, parcela_deduzir: 9360 },
  { faixa: 3, rbt12_min: 360000.01, rbt12_max: 720000, aliquota_nominal: 13.5, parcela_deduzir: 17640 },
  { faixa: 4, rbt12_min: 720000.01, rbt12_max: 1800000, aliquota_nominal: 16, parcela_deduzir: 35640 },
  { faixa: 5, rbt12_min: 1800000.01, rbt12_max: 3600000, aliquota_nominal: 21, parcela_deduzir: 125640 },
  { faixa: 6, rbt12_min: 3600000.01, rbt12_max: 4800000, aliquota_nominal: 33, parcela_deduzir: 648000 },
];
const REP_III: ReparticaoRow[] = [
  { faixa: 1, irpj: 4, csll: 3.5, cofins: 12.82, pis: 2.78, cpp: 43.4, icms: 0, ipi: 0, iss: 33.5 },
  { faixa: 2, irpj: 4, csll: 3.5, cofins: 14.05, pis: 3.05, cpp: 43.4, icms: 0, ipi: 0, iss: 32 },
  { faixa: 3, irpj: 4, csll: 3.5, cofins: 13.64, pis: 2.96, cpp: 43.4, icms: 0, ipi: 0, iss: 32.5 },
  { faixa: 4, irpj: 4, csll: 3.5, cofins: 13.64, pis: 2.96, cpp: 43.4, icms: 0, ipi: 0, iss: 32.5 },
  { faixa: 5, irpj: 4, csll: 3.5, cofins: 12.82, pis: 2.78, cpp: 43.4, icms: 0, ipi: 0, iss: 33.5 },
  { faixa: 6, irpj: 35, csll: 15, cofins: 16.03, pis: 3.47, cpp: 30.5, icms: 0, ipi: 0, iss: 0 },
];
const REP_IV_F1: ReparticaoRow[] = [
  { faixa: 2, irpj: 19.8, csll: 15.2, cofins: 20.55, pis: 4.45, cpp: 0, icms: 0, ipi: 0, iss: 40 },
];
const BRACKETS_IV: BracketRow[] = [
  { faixa: 2, rbt12_min: 180000.01, rbt12_max: 360000, aliquota_nominal: 9, parcela_deduzir: 8100 },
];

describe('apurarSimples', () => {
  it('caso de referência: Anexo III, RBT12 300k, receita 50k → efetiva 8,08%, DAS 4.040,00', () => {
    const r = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [{ anexo: 'III', receita: 50_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    const m = r.memoria.porAnexo[0];
    expect(m.faixa).toBe(2);
    expect(m.aliquotaEfetiva).toBeCloseTo(8.08, 4);
    expect(m.das).toBeCloseTo(4040, 2);
    expect(r.dasTotal).toBeCloseTo(4040, 2);
    // Repartição F2: ISS 32% de 4.040 = 1.292,80; CPP 43,4% = 1.753,36.
    expect(r.tributos.iss).toBeCloseTo(1292.8, 2);
    expect(r.tributos.cpp).toBeCloseTo(1753.36, 2);
    expect(r.sublimiteExcedido).toBe(false);
  });

  it('teto de 5% do ISS (faixa 5): excedente redistribuído, total do DAS preservado', () => {
    // RBT12 3.0M → efetiva 16,812%; ISS bruto = 33,5% → 5,63% efetivo > 5% → cap.
    const r = apurarSimples({
      competencia: '2026-07', rbt12: 3_000_000,
      anexos: [{ anexo: 'III', receita: 100_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    const m = r.memoria.porAnexo[0];
    expect(m.issCapAplicado).toBe(true);
    expect(r.tributos.iss).toBeCloseTo(5000, 0);      // 5% × 100k
    expect(m.das).toBeCloseTo(16_812, 0);             // DAS total do anexo não muda
    const soma = Object.values(r.tributos).reduce((s, v) => s + v, 0);
    expect(soma).toBeCloseTo(m.das, 0);               // redistribuição fecha a conta
  });

  it('sublimite (RBT12 > 3,6M): ICMS/ISS fora do DAS + observação na memória', () => {
    const r = apurarSimples({
      competencia: '2026-07', rbt12: 3_700_000,
      anexos: [{ anexo: 'III', receita: 100_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    expect(r.sublimiteExcedido).toBe(true);
    expect(r.tributos.iss).toBe(0);
    expect(r.tributos.icms).toBe(0);
    expect(r.memoria.observacoes.join(' ')).toContain('recolher por fora');
  });

  it('Anexo IV não tem CPP no DAS (INSS patronal por GPS)', () => {
    const r = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [{ anexo: 'IV', receita: 50_000, brackets: BRACKETS_IV, reparticao: REP_IV_F1 }],
    });
    expect(r.tributos.cpp).toBe(0);
    expect(r.tributos.iss).toBeGreaterThan(0);
  });

  it('ISS retido pelo tomador abate do DAS (nunca negativo)', () => {
    const semRetencao = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [{ anexo: 'III', receita: 50_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    const comRetencao = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [{ anexo: 'III', receita: 50_000, receitaComRetencao: 25_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    expect(comRetencao.issRetidoTotal).toBeCloseTo(semRetencao.tributos.iss / 2, 2);
    expect(comRetencao.tributos.iss).toBeCloseTo(semRetencao.tributos.iss / 2, 2);
  });

  it('empresa mista soma anexos; sem receita ou RBT12 inválido = erro tipado', () => {
    const misto = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [
        { anexo: 'III', receita: 30_000, brackets: BRACKETS_III, reparticao: REP_III },
        { anexo: 'IV', receita: 20_000, brackets: BRACKETS_IV, reparticao: REP_IV_F1 },
      ],
    });
    expect(misto.memoria.porAnexo).toHaveLength(2);
    expect(misto.dasTotal).toBeCloseTo(misto.memoria.porAnexo[0].das + misto.memoria.porAnexo[1].das, 2);

    expect(() => apurarSimples({ competencia: '2026-07', rbt12: 0, anexos: [] })).toThrowError(SimplesDomainError);
    expect(() => apurarSimples({ competencia: '2026-07', rbt12: 100, anexos: [{ anexo: 'III', receita: 0, brackets: BRACKETS_III, reparticao: REP_III }] }))
      .toThrowError(SimplesDomainError);
  });
});
