// Golden do PGDAS-D contra o DAS REAL 02/2026 (R$168,00 principal), Anexo III
// faixa 1. Prova que o motor + o payload reproduzem a guia que o contribuinte
// tem em mãos, ANTES de qualquer chamada de rede. A conferência da SERPRO é o
// oráculo final; este teste garante que chegamos lá com o número certo.

import { describe, it, expect } from 'vitest';
import { apurarSimples } from '../domain/simples/apuracaoDomain';
import { resolveIdAtividade, CODIGO_TRIBUTO } from '../domain/pgdasd/atividadesDomain';
import { buildTransdeclaracaoDados, competenciaToPa, serializeDados } from '../domain/pgdasd/payloadDomain';
import { evaluateTransmissionReadiness, missingLedgerMonths } from '../domain/pgdasd/readinessDomain';
import { windowCompetencias } from '../domain/simples/simplesDomain';

// Anexo III faixa 1 (seed 0075): nominal 6%, sem parcela a deduzir na 1ª faixa.
const BRACKETS_III = [
  { faixa: 1, rbt12_min: 0, rbt12_max: 180000, aliquota_nominal: 6, parcela_deduzir: 0 },
];
const REPARTICAO_III_F1 = [{
  faixa: 1, irpj: 4, csll: 3.5, cofins: 12.82, pis: 2.78, cpp: 43.4, icms: 0, ipi: 0, iss: 33.5,
}];

// Receita 02/2026 = R$2.800,00 → DAS 168,00 (6%). RBT12 na faixa 1.
const RECEITA_FEV = 2800;
const RBT12 = 33600; // 2800 × 12 (empresa estável na 1ª faixa)

describe('PGDAS-D — golden 02/2026', () => {
  const result = apurarSimples({
    competencia: '2026-02', rbt12: RBT12,
    anexos: [{ anexo: 'III', receita: RECEITA_FEV, brackets: BRACKETS_III, reparticao: REPARTICAO_III_F1 }],
  });

  it('o motor reproduz o DAS real ao centavo', () => {
    expect(result.dasTotal).toBe(168);
    expect(result.tributos.irpj).toBe(6.72);
    expect(result.tributos.csll).toBe(5.88);
    expect(result.tributos.cofins).toBe(21.54);
    expect(result.tributos.pis).toBe(4.67);
    expect(result.tributos.cpp).toBe(72.91);
    expect(result.tributos.iss).toBe(56.28);
  });

  it('resolveIdAtividade: dev de software (fator r, sem retenção) → 11', () => {
    expect(resolveIdAtividade({ fator_r_aplicavel: true, iss_retido_padrao: false })).toBe(11);
    expect(resolveIdAtividade({ fator_r_aplicavel: false, iss_retido_padrao: false })).toBe(14);
    expect(resolveIdAtividade({ fator_r_aplicavel: true, iss_retido_padrao: true })).toBe(12);
    expect(resolveIdAtividade({ fator_r_aplicavel: false, iss_retido_padrao: true })).toBe(15);
  });

  it('monta o dados do TRANSDECLARACAO11 com pa numérico e comparação sem zeros', () => {
    const dados = buildTransdeclaracaoDados({
      cnpjCompleto: '48994778000190', competencia: '2026-02', regime: 'competencia',
      receitaMes: RECEITA_FEV, idAtividade: 11,
      receitasBrutasAnteriores: windowCompetencias('2026-02').map((c) => ({ competencia: c, valor: RECEITA_FEV })),
      folhasSalario: [{ competencia: '2026-01', valor: 1000 }],
      valoresParaComparacao: result.tributos,
      indicadorTransmissao: false, tipoDeclaracao: 1,
    });

    expect(dados.pa).toBe(202602);
    expect(typeof dados.pa).toBe('number');
    expect(dados.indicadorComparacao).toBe(true);
    expect(dados.declaracao.receitaPaCompetenciaInterno).toBe(2800);
    expect(dados.declaracao.receitaPaCaixaInterno).toBeNull();
    expect(dados.declaracao.estabelecimentos[0].atividades[0].idAtividade).toBe(11);

    // valoresParaComparacao: os 6 tributos > 0, com códigos oficiais; ICMS/IPI (0) omitidos.
    const codigos = dados.valoresParaComparacao.map((v) => v.codigoTributo).sort((a, b) => a - b);
    expect(codigos).toEqual([
      CODIGO_TRIBUTO.irpj, CODIGO_TRIBUTO.csll, CODIGO_TRIBUTO.cofins,
      CODIGO_TRIBUTO.pis, CODIGO_TRIBUTO.cpp, CODIGO_TRIBUTO.iss,
    ].sort((a, b) => a - b));
    expect(dados.valoresParaComparacao.find((v) => v.codigoTributo === CODIGO_TRIBUTO.icms)).toBeUndefined();
    // 1003/1009 nunca aparecem
    expect(codigos).not.toContain(1003);
    expect(codigos).not.toContain(1009);
  });

  it('regime caixa move a receita para os campos Caixa', () => {
    const dados = buildTransdeclaracaoDados({
      cnpjCompleto: '48994778000190', competencia: '2026-02', regime: 'caixa',
      receitaMes: RECEITA_FEV, idAtividade: 11,
      receitasBrutasAnteriores: [], folhasSalario: [],
      valoresParaComparacao: result.tributos, indicadorTransmissao: false, tipoDeclaracao: 1,
    });
    expect(dados.declaracao.receitaPaCaixaInterno).toBe(2800);
    expect(dados.declaracao.receitaPaCompetenciaInterno).toBeNull();
  });

  it('dados serializa como STRING JSON com round-trip', () => {
    const dados = buildTransdeclaracaoDados({
      cnpjCompleto: '48994778000190', competencia: '2026-02', regime: 'competencia',
      receitaMes: RECEITA_FEV, idAtividade: 11, receitasBrutasAnteriores: [], folhasSalario: [],
      valoresParaComparacao: result.tributos, indicadorTransmissao: false, tipoDeclaracao: 1,
    });
    const s = serializeDados(dados);
    expect(typeof s).toBe('string');
    expect(JSON.parse(s).pa).toBe(202602);
  });

  it('competenciaToPa converte YYYY-MM em número YYYYMM', () => {
    expect(competenciaToPa('2026-02')).toBe(202602);
    expect(competenciaToPa('2025-12')).toBe(202512);
  });
});

describe('PGDAS-D — readiness (o guard que a conferência não pega)', () => {
  const janela = windowCompetencias('2026-02'); // 2025-02 .. 2026-01

  it('ledger completo desde a abertura → pronto', () => {
    const r = evaluateTransmissionReadiness({
      enquadramento: 'ME', optanteSimples: true, issFixo: false, issRetidoPadrao: false,
      inscricaoMunicipal: '12345', rbt12Source: 'ledger', receitaMes: 2800,
      sublimiteExcedido: false, anexosNaCompetencia: 1, competencia: '2026-02',
      dataAbertura: '2025-01-01', competenciasComReceita: janela,
    }, janela);
    expect(r.ready).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('mês faltando na janela → ledger_incompleto com o mês listado', () => {
    const faltando = janela.filter((c) => c !== '2025-07');
    const r = evaluateTransmissionReadiness({
      enquadramento: 'ME', optanteSimples: true, issFixo: false, issRetidoPadrao: false,
      inscricaoMunicipal: '12345', rbt12Source: 'ledger', receitaMes: 2800,
      sublimiteExcedido: false, anexosNaCompetencia: 1, competencia: '2026-02',
      dataAbertura: '2024-01-01', competenciasComReceita: faltando,
    }, janela);
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain('ledger_incompleto');
    expect(r.mesesFaltantes).toContain('2025-07');
  });

  it('não conta meses anteriores à abertura como faltantes', () => {
    const faltantes = missingLedgerMonths({
      janela, dataAbertura: '2025-11-01', competenciasComReceita: ['2025-11', '2025-12', '2026-01'],
    });
    expect(faltantes).toEqual([]); // só 2025-11..2026-01 são exigidos
  });

  it('acumula todos os bloqueios de uma vez (não falha no primeiro)', () => {
    const r = evaluateTransmissionReadiness({
      enquadramento: 'MEI', optanteSimples: false, issFixo: true, issRetidoPadrao: true,
      inscricaoMunicipal: null, rbt12Source: 'manual', receitaMes: 0,
      sublimiteExcedido: true, anexosNaCompetencia: 2, competencia: '2026-02',
      dataAbertura: null, competenciasComReceita: [],
    }, janela);
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining([
      'mei_nao_suportado', 'nao_optante', 'iss_fixo_nao_suportado', 'iss_retido_nao_suportado',
      'inscricao_municipal_ausente', 'rbt12_source_manual', 'sem_receita_na_competencia',
      'sublimite_nao_suportado', 'multi_anexo_nao_suportado',
    ]));
  });
});
