// E3: regras temporais/de estado de alerta — dia útil do DAS, certificado,
// mudança de faixa, Fator R, município e dedupe_key (contrato do UNIQUE parcial).

import { describe, it, expect } from 'vitest';
import {
  buildDedupeKey, dasDueDate, evaluateAlertRules, mapFindingToCandidate,
  AlertSnapshot, AlertCandidate,
} from '../domain/fiscal/alertRulesDomain';
import { InconsistencyFinding } from '../domain/fiscal/inconsistencyDomain';
import { BracketRow } from '../domain/simples/apuracaoDomain';

// Anexo III 2018 (2 primeiras faixas bastam para testar transição).
const BRACKETS: BracketRow[] = [
  { faixa: 1, rbt12_min: 0, rbt12_max: 180_000, aliquota_nominal: 6, parcela_deduzir: 0 },
  { faixa: 2, rbt12_min: 180_000.01, rbt12_max: 360_000, aliquota_nominal: 11.2, parcela_deduzir: 9_360 },
];

const SNAPSHOT_VAZIO: AlertSnapshot = {
  today: new Date(2026, 6, 12),
  apuracoesSemPagamento: [],
  certValidTo: null,
  rbt12Atual: null, rbt12Anterior: null, brackets: null,
  fatorRAtual: null,
  municipioCadastrado: true, codigoIbge: '2510808',
  avisoDiasDas: 8, avisoDiasCert: 30,
};

describe('buildDedupeKey (contrato do UNIQUE parcial em fiscal_alerts)', () => {
  it('é rule|refId|periodo, com "-" para campos ausentes', () => {
    const full: AlertCandidate = { ruleKey: 'das_due', severity: 'warning', title: 'x', refId: 'a1', periodo: '2026-06' };
    expect(buildDedupeKey(full)).toBe('das_due|a1|2026-06');
    const bare: AlertCandidate = { ruleKey: 'certificado_expirando', severity: 'warning', title: 'x' };
    expect(buildDedupeKey(bare)).toBe('certificado_expirando|-|-');
  });
});

describe('dasDueDate (dia 20 do mês seguinte, prorrogado por fim de semana)', () => {
  it('dia útil fica no dia 20', () => {
    expect(dasDueDate('2026-06').toDateString()).toBe('Mon Jul 20 2026');
  });

  it('sábado prorroga para segunda', () => {
    expect(dasDueDate('2026-05').toDateString()).toBe('Mon Jun 22 2026'); // 20/06 é sábado
  });

  it('domingo prorroga para segunda', () => {
    expect(dasDueDate('2026-08').toDateString()).toBe('Mon Sep 21 2026'); // 20/09 é domingo
  });

  it('dezembro vira janeiro do ano seguinte', () => {
    expect(dasDueDate('2026-12').toDateString()).toBe('Wed Jan 20 2027');
  });
});

describe('evaluateAlertRules', () => {
  const apuracao = { apuracaoId: 'ap1', competencia: '2026-06', dasTotal: 4040 };

  it('snapshot sem fatos → zero candidatos', () => {
    expect(evaluateAlertRules(SNAPSHOT_VAZIO)).toEqual([]);
  });

  it('das_due: longe do vencimento não alerta; dentro da antecedência = warning; vencido = critical', () => {
    // Vencimento: seg 2026-07-20. Em 01/07 faltam 19 dias (> 8) → nada.
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, today: new Date(2026, 6, 1), apuracoesSemPagamento: [apuracao] }))
      .toEqual([]);

    const warn = evaluateAlertRules({ ...SNAPSHOT_VAZIO, today: new Date(2026, 6, 15), apuracoesSemPagamento: [apuracao] });
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ ruleKey: 'das_due', severity: 'warning', periodo: '2026-06', refId: 'ap1' });
    expect(warn[0].payload).toMatchObject({ dasTotal: 4040 });

    const late = evaluateAlertRules({ ...SNAPSHOT_VAZIO, today: new Date(2026, 6, 25), apuracoesSemPagamento: [apuracao] });
    expect(late[0]).toMatchObject({ ruleKey: 'das_due', severity: 'critical' });
    expect(late[0].title).toContain('VENCIDO');
  });

  it('certificado_expirando: warning ≤30 dias, critical ≤7 dias, critical expirado', () => {
    const at = (validTo: Date) => evaluateAlertRules({ ...SNAPSHOT_VAZIO, certValidTo: validTo });
    expect(at(new Date(2026, 7, 5))[0]).toMatchObject({ ruleKey: 'certificado_expirando', severity: 'warning' });
    expect(at(new Date(2026, 6, 15))[0]).toMatchObject({ severity: 'critical' });
    const expirado = at(new Date(2026, 6, 1));
    expect(expirado[0].severity).toBe('critical');
    expect(expirado[0].title).toContain('EXPIRADO');
    // Fora da antecedência: nada.
    expect(at(new Date(2026, 11, 1))).toEqual([]);
  });

  it('mudou_de_faixa: dispara na transição via brackets e silencia na mesma faixa', () => {
    const base = { ...SNAPSHOT_VAZIO, brackets: BRACKETS, rbt12Anterior: 170_000 };
    const out = evaluateAlertRules({ ...base, rbt12Atual: 200_000 });
    expect(out[0]).toMatchObject({ ruleKey: 'mudou_de_faixa', severity: 'warning' });
    expect(out[0].payload).toMatchObject({ faixaAnterior: 1, faixaAtual: 2 });
    expect(evaluateAlertRules({ ...base, rbt12Atual: 175_000 })).toEqual([]);
  });

  it('perdeu_fator_r: só abaixo de 28%; null = não aplicável', () => {
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, fatorRAtual: 0.25 })[0])
      .toMatchObject({ ruleKey: 'perdeu_fator_r', severity: 'warning' });
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, fatorRAtual: 0.28 })).toEqual([]);
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, fatorRAtual: null })).toEqual([]);
  });

  it('municipio_nao_cadastrado: exige IBGE conhecido e fora do registry', () => {
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, municipioCadastrado: false })[0])
      .toMatchObject({ ruleKey: 'municipio_nao_cadastrado', severity: 'warning' });
    expect(evaluateAlertRules({ ...SNAPSHOT_VAZIO, municipioCadastrado: false, codigoIbge: null })).toEqual([]);
  });
});

describe('mapFindingToCandidate (herança 1:1 do detector)', () => {
  it('preserva rule/severity/período e usa a 1ª ref', () => {
    const finding: InconsistencyFinding = {
      rule: 'invoice_without_payment', severity: 'critical', competencia: '2026-06',
      title: 'Nota sem recebimento', refs: [{ type: 'nfse', id: 'n1' }], payload: { daysOpen: 90 },
    };
    expect(mapFindingToCandidate(finding)).toEqual({
      ruleKey: 'invoice_without_payment', severity: 'critical', title: 'Nota sem recebimento',
      refType: 'nfse', refId: 'n1', periodo: '2026-06', payload: { daysOpen: 90 },
    });
  });
});
