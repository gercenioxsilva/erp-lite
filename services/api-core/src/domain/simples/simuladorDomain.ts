// Simulador de DAS em tempo real + planejamento tributário — PURO.
// Regra de ouro (teste de contrato garante): NENHUM cálculo próprio de
// DAS/efetiva/teto ISS/sublimite — todo cenário vira um ApuracaoInput e
// delega a apurarSimples. Divergir do motor oficial é o único bug fatal
// de um simulador fiscal.
//
// Semântica de RBT12 (LC123): a janela é dos 12 meses ANTERIORES — receita
// do PRÓPRIO mês não entra no RBT12 dele. Logo:
//   - cenário "+X hoje": muda a BASE do mês (receita), efetiva do RBT12 atual;
//   - cenário "próxima competência": a receita do mês corrente ENTRA na
//     janela, mudando o RBT12 (e possivelmente a faixa) do cenário.

import { round2 } from '../../lib/money';
import { apurarSimples, ApuracaoResult, AnexoApuracaoInput, BracketRow } from './apuracaoDomain';
import { resolveAnexoByFatorR, SimplesDomainError } from './simplesDomain';

export interface SimulatorBase {
  competencia: string;             // 'YYYY-MM' (mês corrente)
  rbt12: number;                   // RBT12 da competência corrente (janela anterior)
  receitaMesLedger: number;        // receita já reconhecida no mês (documentos autorizados)
  receitaPipeline: number;         // drafts abertos/calculados ainda não emitidos
  anexo: string;                   // anexo efetivo da receita simulada
  brackets: BracketRow[];
  reparticao: AnexoApuracaoInput['reparticao'];
}

export interface Projecao {
  competencia: string;
  receitaConsiderada: number;      // ledger + pipeline
  rbt12: number;
  aliquotaEfetiva: number;
  dasProjetado: number;
  faixa: number;
  sublimiteExcedido: boolean;
}

function apurar(base: SimulatorBase, receita: number, rbt12: number): ApuracaoResult {
  return apurarSimples({
    competencia: base.competencia, rbt12,
    anexos: [{ anexo: base.anexo, receita, brackets: base.brackets, reparticao: base.reparticao }],
  });
}

/** Projeção do mês corrente: receita ledger + pipeline, RBT12 atual. */
export function projetarCompetencia(base: SimulatorBase): Projecao {
  const receita = round2(base.receitaMesLedger + base.receitaPipeline);
  if (receita <= 0) {
    return {
      competencia: base.competencia, receitaConsiderada: 0, rbt12: base.rbt12,
      aliquotaEfetiva: 0, dasProjetado: 0,
      faixa: faixaDoRbt12(base.brackets, base.rbt12), sublimiteExcedido: false,
    };
  }
  const r = apurar(base, receita, base.rbt12);
  const m = r.memoria.porAnexo[0];
  return {
    competencia: base.competencia, receitaConsiderada: receita, rbt12: base.rbt12,
    aliquotaEfetiva: m.aliquotaEfetiva, dasProjetado: r.dasTotal,
    faixa: m.faixa, sublimiteExcedido: r.sublimiteExcedido,
  };
}

export function faixaDoRbt12(brackets: BracketRow[], rbt12: number): number {
  const b = brackets.find((x) => rbt12 >= x.rbt12_min && rbt12 <= x.rbt12_max);
  return b?.faixa ?? brackets[brackets.length - 1]?.faixa ?? 0;
}

export interface DistanciaFaixa {
  faixaAtual: number;
  rbt12MaxFaixa: number;
  faltaParaProximaFaixa: number | null;  // null = última faixa
  efetivaNaProximaFaixa: number | null;  // efetiva SE o RBT12 encostar no início da próxima
}

/** "Faltam R$X para mudar de faixa" — sobre o RBT12 (janela anterior). */
export function distanciaProximaFaixa(brackets: BracketRow[], rbt12: number): DistanciaFaixa {
  const atual = brackets.find((b) => rbt12 >= b.rbt12_min && rbt12 <= b.rbt12_max);
  if (!atual) throw new SimplesDomainError('simples_bracket_not_found', { rbt12 });
  const proxima = brackets.find((b) => b.faixa === atual.faixa + 1);
  if (!proxima) return { faixaAtual: atual.faixa, rbt12MaxFaixa: atual.rbt12_max, faltaParaProximaFaixa: null, efetivaNaProximaFaixa: null };
  const rbt12NaProxima = proxima.rbt12_min;
  const efetiva = Math.max(0, proxima.aliquota_nominal - (proxima.parcela_deduzir * 100) / rbt12NaProxima);
  return {
    faixaAtual: atual.faixa,
    rbt12MaxFaixa: atual.rbt12_max,
    faltaParaProximaFaixa: round2(atual.rbt12_max - rbt12),
    efetivaNaProximaFaixa: Math.round(efetiva * 10000) / 10000,
  };
}

export interface Cenario {
  label: string;
  deltaReceita: number;                       // +X reais de faturamento
  timing: 'hoje' | 'proxima_competencia';
}

export interface CenarioResultado {
  label: string;
  timing: Cenario['timing'];
  rbt12Cenario: number;
  receitaCenario: number;
  aliquotaEfetiva: number;
  das: number;
  deltaDas: number;                           // vs projeção base
  faixa: number;
  mudouFaixa: boolean;
}

/**
 * What-if lado a lado. 'hoje' soma na base do mês (RBT12 inalterado);
 * 'proxima_competencia' desloca a janela: RBT12 do cenário = RBT12 atual
 * + receita do mês corrente − receita do mês que sai da janela.
 */
export function simularCenarios(
  base: SimulatorBase,
  cenarios: Cenario[],
  opts: { receitaMesQueSaiDaJanela?: number } = {},
): { baseProjecao: Projecao; cenarios: CenarioResultado[] } {
  const baseProjecao = projetarCompetencia(base);
  const receitaBase = baseProjecao.receitaConsiderada;

  const resultados = cenarios.map((c) => {
    let rbt12Cenario = base.rbt12;
    let receitaCenario: number;
    if (c.timing === 'hoje') {
      receitaCenario = round2(receitaBase + c.deltaReceita);
    } else {
      // Próxima competência: mês corrente entra na janela do RBT12.
      rbt12Cenario = round2(base.rbt12 + receitaBase - (opts.receitaMesQueSaiDaJanela ?? 0));
      receitaCenario = round2(c.deltaReceita);
    }
    if (receitaCenario <= 0) {
      return {
        label: c.label, timing: c.timing, rbt12Cenario, receitaCenario,
        aliquotaEfetiva: 0, das: 0, deltaDas: round2(-baseProjecao.dasProjetado),
        faixa: faixaDoRbt12(base.brackets, rbt12Cenario), mudouFaixa: false,
      };
    }
    const r = apurar(base, receitaCenario, rbt12Cenario);
    const m = r.memoria.porAnexo[0];
    return {
      label: c.label, timing: c.timing, rbt12Cenario, receitaCenario,
      aliquotaEfetiva: m.aliquotaEfetiva, das: r.dasTotal,
      deltaDas: round2(r.dasTotal - baseProjecao.dasProjetado),
      faixa: m.faixa, mudouFaixa: m.faixa !== baseProjecao.faixa,
    };
  });

  return { baseProjecao, cenarios: resultados };
}

export interface ProLaboreComparacao {
  atual: { fatorR: number | null; anexo: string; das: number; aviso?: string };
  simulado: { fatorR: number; anexo: string; das: number };
  economiaMensal: number;   // positivo = aumentar pró-labore REDUZ o DAS
}

/**
 * "Compensa aumentar o pró-labore?" — Fator R decide Anexo III vs V.
 * Degrada com aviso quando a folha da janela está incompleta (não trava o
 * simulador; a apuração oficial é quem trava).
 */
export function compararProLabore(args: {
  base: Omit<SimulatorBase, 'anexo' | 'brackets' | 'reparticao'>;
  folha12mAtual: number;
  mesesComFolha: number;
  deltaProLaboreMensal: number;
  tabelas: { III: Pick<SimulatorBase, 'brackets' | 'reparticao'>; V: Pick<SimulatorBase, 'brackets' | 'reparticao'> };
}): ProLaboreComparacao {
  const receita = round2(args.base.receitaMesLedger + args.base.receitaPipeline);
  if (receita <= 0) throw new SimplesDomainError('sem_receita_na_competencia');

  const resolver = (folha: number, meses: number) => {
    try {
      return { ...resolveAnexoByFatorR({ folha12m: folha, receita12m: args.base.rbt12, mesesComFolha: meses }), aviso: undefined as string | undefined };
    } catch (err) {
      if (err instanceof SimplesDomainError && err.code === 'folha_12m_incompleta') {
        // Degradação: assume a razão com a folha conhecida e sinaliza.
        const fatorR = args.base.rbt12 > 0 ? Math.round((folha / args.base.rbt12) * 10000) / 10000 : 0;
        return { fatorR, anexo: (fatorR >= 0.28 ? 'III' : 'V') as 'III' | 'V', aviso: 'folha_12m_incompleta' };
      }
      throw err;
    }
  };

  const atual = resolver(args.folha12mAtual, args.mesesComFolha);
  // Simulado: +delta mensal aplicado à janela inteira (aproximação de regime).
  const simulado = resolver(round2(args.folha12mAtual + args.deltaProLaboreMensal * 12), 12);

  const apurarCom = (anexo: 'III' | 'V') => apurarSimples({
    competencia: args.base.competencia, rbt12: args.base.rbt12,
    anexos: [{ anexo, receita, brackets: args.tabelas[anexo].brackets, reparticao: args.tabelas[anexo].reparticao }],
  }).dasTotal;

  const dasAtual = apurarCom(atual.anexo);
  const dasSimulado = apurarCom(simulado.anexo);

  return {
    atual: { fatorR: atual.fatorR, anexo: atual.anexo, das: dasAtual, aviso: atual.aviso },
    simulado: { fatorR: simulado.fatorR, anexo: simulado.anexo, das: dasSimulado },
    economiaMensal: round2(dasAtual - dasSimulado),
  };
}
