// Motor Simples Nacional — regras PURAS (sem I/O), molde de lib/taxEngine.ts.
// A alíquota efetiva em si já existe em taxRulesResolver.getSimplesEffectiveRate;
// aqui ficam as regras que a antecedem: enquadramento, Fator R e RBT12.

import { round2 } from '../../lib/money';

export class SimplesDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'SimplesDomainError';
  }
}

/** Limite do Fator R (LC123 §5-J): folha 12m / receita 12m >= 28% → Anexo III. */
export const FATOR_R_THRESHOLD = 0.28;

/**
 * MEI recolhe DAS-SIMEI FIXO (valor mensal por atividade), NÃO percentual
 * sobre receita. Bloqueio explícito no MVP: apurar percentual para MEI
 * produziria DAS errado silenciosamente.
 */
export function assertApuravelPorPercentual(enquadramento: string): void {
  if (enquadramento === 'MEI') {
    throw new SimplesDomainError('mei_das_fixo_nao_suportado', {
      hint: 'MEI recolhe DAS-SIMEI fixo mensal; a apuração percentual não se aplica.',
    });
  }
}

export interface FatorRInput {
  /** Folha de salários + pró-labore dos 12 meses anteriores (mesma janela do RBT12). */
  folha12m: number | null;
  receita12m: number;
  /** Quantos meses de folha existem no ledger para a janela (0-12). */
  mesesComFolha: number;
}

export interface FatorRResult {
  fatorR: number;
  anexo: 'III' | 'V';
}

/**
 * Fator R (LC123 §5-J): >= 0,28 → Anexo III; < 0,28 → Anexo V.
 * TRAVA quando a folha da janela está incompleta em vez de assumir 0 —
 * folha subestimada joga a empresa no Anexo V (mais caro) indevidamente;
 * superestimada dá Anexo III indevido. Dado incompleto = decisão humana.
 */
export function resolveAnexoByFatorR(input: FatorRInput): FatorRResult {
  if (input.receita12m <= 0) throw new SimplesDomainError('receita_12m_ausente');
  if (input.folha12m === null || input.mesesComFolha < 12) {
    throw new SimplesDomainError('folha_12m_incompleta', {
      mesesComFolha: input.mesesComFolha,
      hint: 'Registre a folha das 12 competências da janela (fiscal-config/payroll) antes de apurar por Fator R.',
    });
  }
  const fatorR = input.folha12m / input.receita12m;
  return { fatorR: Math.round(fatorR * 10000) / 10000, anexo: fatorR >= FATOR_R_THRESHOLD ? 'III' : 'V' };
}

export interface Rbt12Input {
  /** Receita bruta por competência ('YYYY-MM' → valor), da janela de 12 meses ANTERIORES à competência apurada. */
  receitasPorCompetencia: Record<string, number>;
  /** Competência sendo apurada ('YYYY-MM'). */
  competencia: string;
  /** Data de abertura da empresa ('YYYY-MM-DD') — dispara a proporcionalização. */
  dataAbertura: string | null;
}

/** Competências 'YYYY-MM' dos 12 meses anteriores à competência dada. */
export function windowCompetencias(competencia: string, months = 12): string[] {
  const [y, m] = competencia.split('-').map(Number);
  const out: string[] = [];
  let year = y, month = m;
  for (let i = 0; i < months; i++) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
    out.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return out;
}

/**
 * RBT12 com regra de INÍCIO DE ATIVIDADE (LC123 art.18 §§1-2):
 * - 1º mês de atividade: RBT12 = receita do próprio mês × 12;
 * - <12 meses de atividade: RBT12 = média das receitas dos meses de
 *   atividade anteriores × 12 (proporcionalização);
 * - >=12 meses: soma simples da janela de 12 competências anteriores.
 * Sem isso, empresa nova cai numa faixa/alíquota errada.
 */
export function computeRbt12(input: Rbt12Input): number {
  const janela = windowCompetencias(input.competencia);
  const mesesAtividade = mesesDeAtividadeAntes(input.competencia, input.dataAbertura);

  if (mesesAtividade !== null && mesesAtividade <= 0) {
    // 1º mês: receita do próprio mês × 12.
    const receitaMes = input.receitasPorCompetencia[input.competencia] ?? 0;
    if (receitaMes <= 0) throw new SimplesDomainError('primeiro_mes_sem_receita', { competencia: input.competencia });
    return round2(receitaMes * 12);
  }

  const competenciasValidas = mesesAtividade !== null && mesesAtividade < 12
    ? janela.slice(0, mesesAtividade)
    : janela;
  const soma = competenciasValidas.reduce((acc, c) => acc + (input.receitasPorCompetencia[c] ?? 0), 0);

  if (mesesAtividade !== null && mesesAtividade < 12) {
    if (mesesAtividade === 0) throw new SimplesDomainError('sem_meses_de_atividade');
    return round2((soma / mesesAtividade) * 12); // média × 12
  }
  return round2(soma);
}

/** Meses COMPLETOS de atividade antes da competência (null = sem data de abertura ⇒ assume >=12). */
export function mesesDeAtividadeAntes(competencia: string, dataAbertura: string | null): number | null {
  if (!dataAbertura) return null;
  const [cy, cm] = competencia.split('-').map(Number);
  const [ay, am] = dataAbertura.split('-').map(Number);
  const diff = (cy - ay) * 12 + (cm - am);
  if (diff < 0) throw new SimplesDomainError('competencia_anterior_abertura', { competencia, dataAbertura });
  return Math.min(diff, 12);
}

/** Sublimite estadual/municipal (LC123 art.13-A): acima de R$3,6M de RBT12,
 *  ICMS e ISS saem do DAS e são recolhidos "por fora". Flag para a apuração. */
export const SUBLIMITE_ICMS_ISS = 3_600_000;
export function exigeIcmsIssPorFora(rbt12: number): boolean {
  return rbt12 > SUBLIMITE_ICMS_ISS;
}
