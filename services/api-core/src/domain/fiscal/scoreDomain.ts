// Score Fiscal 0–100 — função PURA de pesos sobre os findings + completude
// do cadastro + pendências de conciliação. CARÊNCIA para empresa nova (a
// crítica do design): sem penalidade de cadastro antes da 1ª emissão e sem
// penalidade de conciliação antes do 1º import — senão toda empresa nasce
// 60/100 e o score perde credibilidade no primeiro contato.

import { InconsistencyFinding } from './inconsistencyDomain';

export interface ScoreBreakdown {
  category: 'inconsistencias' | 'cadastro' | 'conciliacao';
  points: number;   // pontos PERDIDOS (positivo)
  max: number;      // teto de perda da categoria
  issues: string[];
}

export interface ScoreInput {
  findings: InconsistencyFinding[];
  readiness: { ready: boolean; reasons: string[] };
  reconPendingCount: number;
  // Carências:
  hasAnyEmission: boolean;  // já emitiu alguma nota? (senão cadastro não pune)
  hasAnyImport: boolean;    // já importou algum arquivo? (senão conciliação não pune)
}

const PENALTY = { critical: 10, warning: 4, info: 1 } as const;
const CAPS = { inconsistencias: 50, cadastro: 25, conciliacao: 25 } as const;
const READINESS_PENALTY = 5;   // por pendência de cadastro
const RECON_PENALTY = 1;       // por transação pendente de conciliação

export function computeFiscalScore(input: ScoreInput): { score: number; breakdown: ScoreBreakdown[] } {
  const inconsistencias: ScoreBreakdown = {
    category: 'inconsistencias', points: 0, max: CAPS.inconsistencias,
    issues: input.findings.map((f) => f.title),
  };
  for (const f of input.findings) inconsistencias.points += PENALTY[f.severity];
  inconsistencias.points = Math.min(inconsistencias.points, CAPS.inconsistencias);

  const cadastro: ScoreBreakdown = { category: 'cadastro', points: 0, max: CAPS.cadastro, issues: [] };
  if (input.hasAnyEmission && !input.readiness.ready) {
    cadastro.issues = input.readiness.reasons;
    cadastro.points = Math.min(input.readiness.reasons.length * READINESS_PENALTY, CAPS.cadastro);
  }

  const conciliacao: ScoreBreakdown = { category: 'conciliacao', points: 0, max: CAPS.conciliacao, issues: [] };
  if (input.hasAnyImport && input.reconPendingCount > 0) {
    conciliacao.points = Math.min(input.reconPendingCount * RECON_PENALTY, CAPS.conciliacao);
    conciliacao.issues = [`${input.reconPendingCount} transação(ões) pendente(s) de conciliação`];
  }

  const breakdown = [inconsistencias, cadastro, conciliacao];
  const score = Math.max(0, 100 - breakdown.reduce((s, b) => s + b.points, 0));
  return { score, breakdown };
}
