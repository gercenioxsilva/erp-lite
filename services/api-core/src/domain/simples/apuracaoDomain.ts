// Apuração PGDAS-D — cálculo PURO (molde taxEngine): recebe receita segregada
// por anexo + RBT12 + tabelas (brackets/repartição) já resolvidas e devolve o
// DAS por tributo com a MEMÓRIA DE CÁLCULO completa. Regras aplicadas:
//   - efetiva = nominal − parcela_deduzir×100/RBT12 (LC123 art.18);
//   - repartição por tributo conforme a faixa (Anexo IV sem CPP);
//   - TETO do ISS: percentual efetivo de ISS limitado a 5% (LC123 §22-A) —
//     o excedente é redistribuído proporcionalmente entre os demais tributos;
//   - SUBLIMITE (RBT12 > R$3,6M): ICMS/ISS saem do DAS (recolhidos por fora);
//   - ISS retido pelo tomador abate do valor de ISS do DAS.

import { round2 } from '../../lib/money';
import { SimplesDomainError, exigeIcmsIssPorFora } from './simplesDomain';

export const TRIBUTOS = ['irpj', 'csll', 'cofins', 'pis', 'cpp', 'icms', 'ipi', 'iss'] as const;
export type Tributo = typeof TRIBUTOS[number];

export interface BracketRow {
  faixa: number;
  rbt12_min: number;
  rbt12_max: number;
  aliquota_nominal: number;  // %
  parcela_deduzir: number;   // R$
}

export type ReparticaoRow = Record<Tributo, number> & { faixa: number };

export interface AnexoApuracaoInput {
  anexo: string;                 // 'I'..'V'
  receita: number;               // receita tributável do anexo na competência
  receitaComRetencao?: number;   // parcela com ISS retido pelo tomador
  brackets: BracketRow[];
  reparticao: ReparticaoRow[];
}

export interface ApuracaoInput {
  competencia: string;           // 'YYYY-MM'
  rbt12: number;
  anexos: AnexoApuracaoInput[];
}

export interface AnexoMemoria {
  anexo: string;
  receita: number;
  faixa: number;
  aliquotaNominal: number;
  parcelaDeduzir: number;
  aliquotaEfetiva: number;       // %
  issCapAplicado: boolean;
  das: number;
  tributos: Record<Tributo, number>;
  issRetidoAbatido: number;
}

export interface ApuracaoResult {
  dasTotal: number;
  tributos: Record<Tributo, number>;
  issRetidoTotal: number;
  sublimiteExcedido: boolean;
  memoria: {
    competencia: string;
    rbt12: number;
    sublimiteExcedido: boolean;
    porAnexo: AnexoMemoria[];
    observacoes: string[];
  };
}

const ISS_CAP_PERCENT = 5; // teto do ISS efetivo (LC123 §22-A)

const zeroTributos = (): Record<Tributo, number> =>
  Object.fromEntries(TRIBUTOS.map((t) => [t, 0])) as Record<Tributo, number>;

function findBracket(brackets: BracketRow[], rbt12: number): BracketRow {
  const b = brackets.find((r) => rbt12 >= r.rbt12_min && rbt12 <= r.rbt12_max);
  if (!b) throw new SimplesDomainError('simples_bracket_not_found', { rbt12 });
  return b;
}

/** Apura UMA competência (multi-anexo: empresa mista soma os anexos). */
export function apurarSimples(input: ApuracaoInput): ApuracaoResult {
  if (input.rbt12 <= 0) throw new SimplesDomainError('rbt12_invalido', { rbt12: input.rbt12 });
  const anexosComReceita = input.anexos.filter((a) => a.receita > 0);
  if (anexosComReceita.length === 0) throw new SimplesDomainError('sem_receita_na_competencia');

  const sublimiteExcedido = exigeIcmsIssPorFora(input.rbt12);
  const totais = zeroTributos();
  const porAnexo: AnexoMemoria[] = [];
  const observacoes: string[] = [];
  let issRetidoTotal = 0;

  if (sublimiteExcedido) {
    observacoes.push('RBT12 acima de R$3.600.000,00: ICMS e ISS excluídos do DAS — recolher por fora conforme legislação estadual/municipal (LC123 art.13-A).');
  }

  for (const a of anexosComReceita) {
    const bracket = findBracket(a.brackets, input.rbt12);
    const efetiva = Math.max(0, bracket.aliquota_nominal - (bracket.parcela_deduzir * 100) / input.rbt12);
    const rep = a.reparticao.find((r) => r.faixa === bracket.faixa);
    if (!rep) throw new SimplesDomainError('reparticao_not_found', { anexo: a.anexo, faixa: bracket.faixa });

    // Percentuais da faixa (0-100 por tributo, somando ~100).
    let percents: Record<Tributo, number> = Object.fromEntries(
      TRIBUTOS.map((t) => [t, rep[t] ?? 0]),
    ) as Record<Tributo, number>;

    // TETO do ISS: percentual efetivo de ISS (efetiva × %iss) não passa de 5%.
    let issCapAplicado = false;
    const issEfetivo = (efetiva * percents.iss) / 100;
    if (percents.iss > 0 && issEfetivo > ISS_CAP_PERCENT) {
      issCapAplicado = true;
      const cappedShare = (ISS_CAP_PERCENT / efetiva) * 100; // novo %iss
      const excess = percents.iss - cappedShare;
      const others = TRIBUTOS.filter((t) => t !== 'iss' && percents[t] > 0);
      const otherSum = others.reduce((s, t) => s + percents[t], 0);
      const redistributed = { ...percents, iss: cappedShare };
      for (const t of others) redistributed[t] = percents[t] + (excess * percents[t]) / otherSum;
      percents = redistributed;
      observacoes.push(`Anexo ${a.anexo}: teto de 5% do ISS aplicado (LC123 §22-A); excedente redistribuído.`);
    }

    // Sublimite: ICMS/ISS ficam FORA do DAS (não são redistribuídos — o DAS
    // simplesmente não os contém; recolhimento por fora).
    if (sublimiteExcedido) { percents.icms = 0; percents.iss = 0; }

    const das = round2((a.receita * efetiva) / 100);
    const tributos = zeroTributos();
    for (const t of TRIBUTOS) tributos[t] = round2((das * percents[t]) / 100);

    // ISS retido pelo tomador: abate do ISS do DAS (nunca fica negativo).
    const receitaRetencao = Math.min(a.receitaComRetencao ?? 0, a.receita);
    const issRetido = round2(Math.min(tributos.iss, (receitaRetencao / a.receita) * tributos.iss || 0));
    tributos.iss = round2(tributos.iss - issRetido);
    issRetidoTotal = round2(issRetidoTotal + issRetido);

    for (const t of TRIBUTOS) totais[t] = round2(totais[t] + tributos[t]);
    porAnexo.push({
      anexo: a.anexo, receita: a.receita, faixa: bracket.faixa,
      aliquotaNominal: bracket.aliquota_nominal, parcelaDeduzir: bracket.parcela_deduzir,
      aliquotaEfetiva: Math.round(efetiva * 10000) / 10000,
      issCapAplicado, das, tributos, issRetidoAbatido: issRetido,
    });
  }

  const dasTotal = round2(TRIBUTOS.reduce((s, t) => s + totais[t], 0));
  return {
    dasTotal, tributos: totais, issRetidoTotal, sublimiteExcedido,
    memoria: { competencia: input.competencia, rbt12: input.rbt12, sublimiteExcedido, porAnexo, observacoes },
  };
}
