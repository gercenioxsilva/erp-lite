// Simulador (E1): TESTE DE CONTRATO (simulador == apuração oficial, mesmo
// DAS para a mesma entrada), semântica RBT12 janela-anterior nos dois
// timings e distância de faixa.

import { describe, it, expect } from 'vitest';
import { apurarSimples, BracketRow, ReparticaoRow } from '../domain/simples/apuracaoDomain';
import {
  projetarCompetencia, distanciaProximaFaixa, simularCenarios, compararProLabore, SimulatorBase,
} from '../domain/simples/simuladorDomain';

const BRACKETS_III: BracketRow[] = [
  { faixa: 1, rbt12_min: 0, rbt12_max: 180000, aliquota_nominal: 6, parcela_deduzir: 0 },
  { faixa: 2, rbt12_min: 180000.01, rbt12_max: 360000, aliquota_nominal: 11.2, parcela_deduzir: 9360 },
  { faixa: 3, rbt12_min: 360000.01, rbt12_max: 720000, aliquota_nominal: 13.5, parcela_deduzir: 17640 },
  { faixa: 4, rbt12_min: 720000.01, rbt12_max: 1800000, aliquota_nominal: 16, parcela_deduzir: 35640 },
  { faixa: 5, rbt12_min: 1800000.01, rbt12_max: 3600000, aliquota_nominal: 21, parcela_deduzir: 125640 },
  { faixa: 6, rbt12_min: 3600000.01, rbt12_max: 4800000, aliquota_nominal: 33, parcela_deduzir: 648000 },
];
const REP_III: ReparticaoRow[] = [1, 2, 3, 4, 5, 6].map((faixa) => ({
  faixa, irpj: 4, csll: 3.5, cofins: 13, pis: 3, cpp: 43.5, icms: 0, ipi: 0, iss: 33,
}));
const REP_V: ReparticaoRow[] = [1, 2, 3, 4, 5, 6].map((faixa) => ({
  faixa, irpj: 25, csll: 15, cofins: 14.1, pis: 3.05, cpp: 28.85, icms: 0, ipi: 0, iss: 14,
}));
const BRACKETS_V: BracketRow[] = [
  { faixa: 1, rbt12_min: 0, rbt12_max: 180000, aliquota_nominal: 15.5, parcela_deduzir: 0 },
  { faixa: 2, rbt12_min: 180000.01, rbt12_max: 360000, aliquota_nominal: 18, parcela_deduzir: 4500 },
  { faixa: 3, rbt12_min: 360000.01, rbt12_max: 720000, aliquota_nominal: 19.5, parcela_deduzir: 9900 },
  { faixa: 4, rbt12_min: 720000.01, rbt12_max: 1800000, aliquota_nominal: 20.5, parcela_deduzir: 17100 },
  { faixa: 5, rbt12_min: 1800000.01, rbt12_max: 3600000, aliquota_nominal: 23, parcela_deduzir: 62100 },
  { faixa: 6, rbt12_min: 3600000.01, rbt12_max: 4800000, aliquota_nominal: 30.5, parcela_deduzir: 540000 },
];

const BASE: SimulatorBase = {
  competencia: '2026-07', rbt12: 300_000,
  receitaMesLedger: 30_000, receitaPipeline: 20_000,
  anexo: 'III', brackets: BRACKETS_III, reparticao: REP_III,
};

describe('CONTRATO: simulador == apuração oficial', () => {
  it('mesma entrada produz o MESMO DAS que apurarSimples', () => {
    const proj = projetarCompetencia(BASE);
    const oficial = apurarSimples({
      competencia: '2026-07', rbt12: 300_000,
      anexos: [{ anexo: 'III', receita: 50_000, brackets: BRACKETS_III, reparticao: REP_III }],
    });
    expect(proj.dasProjetado).toBe(oficial.dasTotal);
    expect(proj.aliquotaEfetiva).toBe(oficial.memoria.porAnexo[0].aliquotaEfetiva);
    expect(proj.aliquotaEfetiva).toBeCloseTo(8.08, 4); // valor oficial conhecido
  });

  it('mês sem receita projeta DAS 0 sem lançar erro', () => {
    const proj = projetarCompetencia({ ...BASE, receitaMesLedger: 0, receitaPipeline: 0 });
    expect(proj.dasProjetado).toBe(0);
    expect(proj.faixa).toBe(2);
  });
});

describe('semântica RBT12 (janela anterior)', () => {
  it("timing 'hoje': +X muda a BASE do mês, RBT12 inalterado", () => {
    const { baseProjecao, cenarios } = simularCenarios(BASE, [
      { label: '+10k', deltaReceita: 10_000, timing: 'hoje' },
    ]);
    const c = cenarios[0];
    expect(c.rbt12Cenario).toBe(300_000);            // RBT12 NÃO muda
    expect(c.receitaCenario).toBe(60_000);           // 50k base + 10k
    expect(c.aliquotaEfetiva).toBe(baseProjecao.aliquotaEfetiva); // mesma efetiva
    expect(c.deltaDas).toBeCloseTo(10_000 * 0.0808, 2);
  });

  it("timing 'proxima_competencia': receita do mês entra na janela e mês antigo sai", () => {
    const { cenarios } = simularCenarios(BASE, [
      { label: 'mês que vem', deltaReceita: 10_000, timing: 'proxima_competencia' },
    ], { receitaMesQueSaiDaJanela: 8_000 });
    const c = cenarios[0];
    expect(c.rbt12Cenario).toBe(300_000 + 50_000 - 8_000); // 342k
    expect(c.receitaCenario).toBe(10_000);
    // Ainda faixa 2 (342k < 360k), efetiva maior que a base (RBT12 subiu).
    expect(c.faixa).toBe(2);
    expect(c.aliquotaEfetiva).toBeGreaterThan(8.08);
  });

  it('cruzar a faixa no cenário futuro marca mudouFaixa', () => {
    const { cenarios } = simularCenarios(
      { ...BASE, receitaMesLedger: 80_000, receitaPipeline: 0 }, // 300k + 80k − 0 = 380k → faixa 3
      [{ label: 'próximo', deltaReceita: 10_000, timing: 'proxima_competencia' }],
    );
    expect(cenarios[0].faixa).toBe(3);
    expect(cenarios[0].mudouFaixa).toBe(true);
  });
});

describe('distanciaProximaFaixa', () => {
  it('reporta quanto falta e a efetiva na próxima faixa', () => {
    const d = distanciaProximaFaixa(BRACKETS_III, 300_000);
    expect(d.faixaAtual).toBe(2);
    expect(d.faltaParaProximaFaixa).toBe(60_000);
    expect(d.efetivaNaProximaFaixa).toBeGreaterThan(8);
  });
  it('última faixa → null', () => {
    const d = distanciaProximaFaixa(BRACKETS_III, 4_000_000);
    expect(d.faltaParaProximaFaixa).toBeNull();
  });
});

describe('compararProLabore (Fator R)', () => {
  it('aumento que cruza 28% troca V→III e calcula economia', () => {
    const r = compararProLabore({
      base: { competencia: '2026-07', rbt12: 300_000, receitaMesLedger: 50_000, receitaPipeline: 0 },
      folha12mAtual: 60_000, mesesComFolha: 12,      // 20% → Anexo V
      deltaProLaboreMensal: 2_500,                   // +30k/ano → 90k = 30% → Anexo III
      tabelas: { III: { brackets: BRACKETS_III, reparticao: REP_III }, V: { brackets: BRACKETS_V, reparticao: REP_V } },
    });
    expect(r.atual.anexo).toBe('V');
    expect(r.simulado.anexo).toBe('III');
    expect(r.economiaMensal).toBeGreaterThan(0); // III é mais barato nesta faixa
  });

  it('folha incompleta degrada com aviso em vez de travar', () => {
    const r = compararProLabore({
      base: { competencia: '2026-07', rbt12: 300_000, receitaMesLedger: 50_000, receitaPipeline: 0 },
      folha12mAtual: 30_000, mesesComFolha: 6,
      deltaProLaboreMensal: 1_000,
      tabelas: { III: { brackets: BRACKETS_III, reparticao: REP_III }, V: { brackets: BRACKETS_V, reparticao: REP_V } },
    });
    expect(r.atual.aviso).toBe('folha_12m_incompleta');
  });
});
