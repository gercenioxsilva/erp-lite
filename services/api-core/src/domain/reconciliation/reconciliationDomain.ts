// Motor de conciliação — scoring PURO (sem I/O). Estratégias em cascata:
// chave exata (NSU/autorização no reference ou memo) > valor exato > valor
// com tolerância; proximidade de data modula o score; e — quando o serviço
// fornece — a SIMILARIDADE de descrição (0..1) soma um componente ponderado
// (rule.descriptionWeight). O serviço decide auto-confirmar (score >= threshold
// da regra) ou sugerir para a fila "Pendente de Conciliação". A similaridade é
// calculada FORA daqui (lexical local e/ou IA) e injetada já pronta, para o
// domínio seguir sem I/O.

import { SEMANTIC_KEY_FLOOR } from './descriptionSimilarity';

export class ReconciliationDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ReconciliationDomainError';
  }
}

/** Componente de descrição no score: rule.descriptionWeight × similaridade. */
function descriptionScore(similarity: number | undefined, rule: MatchRule): { add: number; matched: boolean } {
  const weight = rule.descriptionWeight ?? 0;
  if (weight <= 0 || similarity == null || similarity <= 0) return { add: 0, matched: false };
  return { add: weight * similarity, matched: similarity >= SEMANTIC_KEY_FLOOR };
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
  /** Peso do componente de similaridade de descrição (0..1). Ausente/0 →
   *  comportamento idêntico ao histórico (sem contribuição semântica). */
  descriptionWeight?: number;
  /** Liga o enriquecimento por IA no serviço; o domínio ignora esta flag. */
  useAiMatching?: boolean;
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

/** Candidato compatível por valor (mesma checagem-porteira de scoreCandidate).
 *  Usado pelo serviço para pré-filtrar antes de calcular similaridade (evita
 *  gastar IA em candidato que o valor já descartaria). */
export function valueCompatible(tx: TxForMatch, cand: ReceivableCandidate, rule: MatchRule): boolean {
  const value = txAmount(tx, rule);
  if (value === null || value <= 0) return false;
  return Math.abs(cand.amount - value) <= rule.amountTolerance;
}

/**
 * Score de um candidato contra uma transação:
 *  - NSU/autorização presente na descrição do receivable → match forte (0.6)
 *  - valor exato → 0.5 | valor dentro da tolerância → 0.35
 *  - data dentro da janela → +0.4 decaindo linearmente com a distância
 *  - similaridade de descrição (0..1, opcional) → + rule.descriptionWeight × sim
 * Sem valor compatível o candidato é descartado (score 0).
 */
export function scoreCandidate(tx: TxForMatch, cand: ReceivableCandidate, rule: MatchRule, similarity?: number): ScoredCandidate | null {
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

  const sem = descriptionScore(similarity, rule);
  if (sem.add > 0) { score += sem.add; if (sem.matched) keys.push('description_semantic'); }

  return { receivableId: cand.id, score: Math.min(1, Math.round(score * 10000) / 10000), matchedKeys: keys, amountMatched: cand.amount };
}

/** Ranqueia todos os candidatos compatíveis, melhor primeiro. `similarities`
 *  (opcional) mapeia candidateId → similaridade de descrição (0..1). */
export function rankCandidates(
  tx: TxForMatch, candidates: ReceivableCandidate[], rule: MatchRule,
  similarities?: Map<string, number>,
): ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(tx, c, rule, similarities?.get(c.id)))
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

// ── Débitos ↔ contas a pagar (Tesouraria, 0082) ─────────────────────────────
// Espelho do scoring de receita: um DÉBITO bancário (amount < 0) casa contra
// payables abertos. O sinal forte aqui é o DOCUMENTO da contraparte (o Open
// Finance traz o CNPJ/CPF do recebedor no paymentData) — mais confiável que
// NSU, que débito não tem.

export interface PayableCandidate {
  id: string;
  /** Saldo aberto: amount − paid_amount (pagamento parcial já abatido). */
  openAmount: number;
  dueDate: string | Date | null;
  supplierDocument: string | null;  // dígitos do CNPJ/CPF do fornecedor
  description: string | null;
}

export interface ScoredPayable {
  payableId: string;
  score: number;
  matchedKeys: string[];
  amountMatched: number;
}

/** Valor do débito para matching: |amount| de transação bancária negativa. */
export function txDebitAmount(tx: TxForMatch): number | null {
  if (tx.source !== 'bank') return null;               // débito só existe em extrato
  if (tx.amount === null || tx.amount >= 0) return null;
  return Math.abs(tx.amount);
}

/** Débito compatível por valor com o saldo aberto do payable (pré-filtro). */
export function payableValueCompatible(
  tx: TxForMatch & { counterpartDocument?: string | null }, cand: PayableCandidate, rule: MatchRule,
): boolean {
  const value = txDebitAmount(tx);
  if (value === null || value <= 0) return false;
  return Math.abs(cand.openAmount - value) <= rule.amountTolerance;
}

export function scorePayableCandidate(
  tx: TxForMatch & { counterpartDocument?: string | null },
  cand: PayableCandidate, rule: MatchRule, similarity?: number,
): ScoredPayable | null {
  const value = txDebitAmount(tx);
  if (value === null || value <= 0) return null;

  const keys: string[] = [];
  let score = 0;

  const diff = Math.abs(cand.openAmount - value);
  if (diff === 0) { score += 0.5; keys.push('amount_exact'); }
  else if (diff <= rule.amountTolerance) { score += 0.35; keys.push('amount_tolerance'); }
  else return null; // valor incompatível nunca é candidato

  if (tx.counterpartDocument && cand.supplierDocument && tx.counterpartDocument === cand.supplierDocument) {
    score += 0.6; keys.push('supplier_document');
  }

  if (tx.occurredAt && cand.dueDate) {
    const d = Math.abs(Math.round((tx.occurredAt.getTime() - new Date(`${cand.dueDate}T12:00:00`).getTime()) / 86_400_000));
    if (d <= rule.dateWindowDays) {
      score += 0.4 * (1 - d / (rule.dateWindowDays + 1));
      keys.push('date_window');
    }
  }

  const sem = descriptionScore(similarity, rule);
  if (sem.add > 0) { score += sem.add; if (sem.matched) keys.push('description_semantic'); }

  return { payableId: cand.id, score: Math.min(1, Math.round(score * 10000) / 10000), matchedKeys: keys, amountMatched: value };
}

export function rankPayableCandidates(
  tx: TxForMatch & { counterpartDocument?: string | null },
  candidates: PayableCandidate[], rule: MatchRule,
  similarities?: Map<string, number>,
): ScoredPayable[] {
  return candidates
    .map((c) => scorePayableCandidate(tx, c, rule, similarities?.get(c.id)))
    .filter((s): s is ScoredPayable => s !== null)
    .sort((a, b) => b.score - a.score);
}

/** Mesmo desfecho do lado da receita: alto e sem empate → auto; senão sugere. */
export function decidePayableOutcome(ranked: ScoredPayable[], rule: MatchRule):
  | { kind: 'auto_confirm'; best: ScoredPayable }
  | { kind: 'suggest'; best: ScoredPayable }
  | { kind: 'unmatched' } {
  if (ranked.length === 0) return { kind: 'unmatched' };
  const [best, second] = ranked;
  if (best.score >= rule.autoConfirmThreshold && (!second || second.score < best.score)) {
    return { kind: 'auto_confirm', best };
  }
  return { kind: 'suggest', best };
}
