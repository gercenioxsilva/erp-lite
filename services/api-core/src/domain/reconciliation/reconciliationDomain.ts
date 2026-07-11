// Motor de conciliação — scoring PURO (sem I/O). Estratégias em cascata:
// chave exata (NSU/autorização no reference ou memo) > valor exato > valor
// com tolerância; proximidade de data modula o score. O serviço decide
// auto-confirmar (score >= threshold da regra) ou sugerir para a fila
// "Pendente de Conciliação".

export class ReconciliationDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ReconciliationDomainError';
  }
}

export interface TxForMatch {
  id: string;
  source: 'bank' | 'acquirer' | 'file';
  occurredAt: Date | null;
  nsu: string | null;
  authorizationCode: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  amount: number | null;     // OFX sinalizado
  memo: string | null;
}

export interface ReceivableCandidate {
  id: string;
  amount: number;
  dueDate: string | null;    // YYYY-MM-DD
  description: string | null;
  posSaleId: string | null;
}

export interface MatchRule {
  amountTolerance: number;
  dateWindowDays: number;
  autoConfirmThreshold: number;
  matchNetAmount: boolean;
}

export interface ScoredCandidate {
  receivableId: string;
  score: number;             // 0..1
  matchedKeys: string[];
  amountMatched: number;
}

/** Valor efetivo da transação para o match (depósito líquido vs bruto). */
export function txAmount(tx: TxForMatch, rule: MatchRule): number | null {
  if (tx.source === 'bank') return tx.amount !== null && tx.amount > 0 ? tx.amount : null; // só créditos conciliam receita
  return (rule.matchNetAmount ? tx.netAmount : tx.grossAmount) ?? tx.grossAmount ?? tx.netAmount;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86_400_000));
}

/**
 * Score de um candidato contra uma transação:
 *  - NSU/autorização presente na descrição do receivable → match forte (0.6)
 *  - valor exato → 0.5 | valor dentro da tolerância → 0.35
 *  - data dentro da janela → +0.4 decaindo linearmente com a distância
 * Sem valor compatível o candidato é descartado (score 0).
 */
export function scoreCandidate(tx: TxForMatch, cand: ReceivableCandidate, rule: MatchRule): ScoredCandidate | null {
  const value = txAmount(tx, rule);
  if (value === null || value <= 0) return null;

  const keys: string[] = [];
  let score = 0;

  const diff = Math.abs(cand.amount - value);
  if (diff === 0) { score += 0.5; keys.push('amount_exact'); }
  else if (diff <= rule.amountTolerance) { score += 0.35; keys.push('amount_tolerance'); }
  else return null; // valor incompatível nunca é candidato

  const ref = `${cand.description ?? ''}`;
  if (tx.nsu && ref.includes(tx.nsu)) { score += 0.6; keys.push('nsu'); }
  else if (tx.authorizationCode && ref.includes(tx.authorizationCode)) { score += 0.5; keys.push('authorization'); }

  if (tx.occurredAt && cand.dueDate) {
    const d = daysBetween(tx.occurredAt, new Date(`${cand.dueDate}T12:00:00`));
    if (d <= rule.dateWindowDays) {
      score += 0.4 * (1 - d / (rule.dateWindowDays + 1));
      keys.push('date_window');
    }
  }

  return { receivableId: cand.id, score: Math.min(1, Math.round(score * 10000) / 10000), matchedKeys: keys, amountMatched: cand.amount };
}

/** Ranqueia todos os candidatos compatíveis, melhor primeiro. */
export function rankCandidates(tx: TxForMatch, candidates: ReceivableCandidate[], rule: MatchRule): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(tx, c, rule))
    .filter((s): s is ScoredCandidate => s !== null)
    .sort((a, b) => b.score - a.score);
}

/** Decide o desfecho do matching de uma transação. */
export function decideOutcome(ranked: ScoredCandidate[], rule: MatchRule):
  | { kind: 'auto_confirm'; best: ScoredCandidate }
  | { kind: 'suggest'; best: ScoredCandidate }
  | { kind: 'unmatched' } {
  if (ranked.length === 0) return { kind: 'unmatched' };
  const [best, second] = ranked;
  // Auto-confirma só com score alto E sem empate ambíguo no topo.
  if (best.score >= rule.autoConfirmThreshold && (!second || second.score < best.score)) {
    return { kind: 'auto_confirm', best };
  }
  return { kind: 'suggest', best };
}

export function matchDedupKey(txId: string, targetType: string, targetId: string): string {
  return `recon:${txId}:${targetType}:${targetId}`;
}
