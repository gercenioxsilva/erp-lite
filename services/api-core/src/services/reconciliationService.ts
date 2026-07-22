// Motor de conciliação (0072) — camada de serviço.
// runReconciliation: varre imported_transactions 'pending' → ranqueia
// receivables candidatos (inclui os POS 'pending — adquirente') → auto-confirma
// acima do threshold ou sugere (fila "Pendente de Conciliação").
// Confirmação = registerReceivablePayment (reference=NSU/FITID) + match
// 'confirmed' + writeback do reconciliation_status — este serviço é o ÚNICO
// escritor desse status. Tudo auditado em fiscal_events.

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { importedTransactions, reconciliationMatches, reconciliationRules, receivables, payables, suppliers } from '../db/schema';
import { registerReceivablePayment } from './receivableService';
import { registerPayablePayment, VALID_PAYABLE_METHODS, PayableMethod } from './payablePaymentService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { assertCompetenciaAberta } from './fiscalPeriodLockGuard';
import { toNumber, toDecimalString } from '../lib/money';
import {
  TxForMatch, ReceivableCandidate, MatchRule, rankCandidates, decideOutcome,
  matchDedupKey, ReconciliationDomainError, valueCompatible, payableValueCompatible,
  PayableCandidate, rankPayableCandidates, decidePayableOutcome, txDebitAmount,
} from '../domain/reconciliation/reconciliationDomain';
import { scoreDescriptions, SemanticCandidate } from './reconciliationSemanticService';

export type DrizzleDB = typeof _db;

// Defaults espelham as colunas de reconciliation_rules (0072 + 0090), para o
// comportamento ser o mesmo com ou sem regra salva. O peso 0.25 liga o
// componente LEXICAL (grátis); a IA só entra com use_ai_matching explícito.
const DEFAULT_RULE: MatchRule = {
  amountTolerance: 0.01, dateWindowDays: 3, autoConfirmThreshold: 0.9, matchNetAmount: true,
  descriptionWeight: 0.25, useAiMatching: false,
};

export async function getRule(tenantId: string, companyId: string, db: DrizzleDB = _db): Promise<MatchRule> {
  const rows = await db.select().from(reconciliationRules)
    .where(and(eq(reconciliationRules.tenant_id, tenantId), eq(reconciliationRules.is_active, true)));
  const specific = rows.find((r) => r.company_id === companyId) ?? rows.find((r) => r.company_id === null);
  if (!specific) return DEFAULT_RULE;
  return {
    amountTolerance: toNumber(specific.amount_tolerance),
    dateWindowDays: specific.date_window_days,
    autoConfirmThreshold: toNumber(specific.auto_confirm_threshold),
    matchNetAmount: specific.match_net_amount,
    descriptionWeight: toNumber(specific.description_weight),
    useAiMatching: specific.use_ai_matching,
  };
}

/** Similaridade de descrição candidateId → 0..1 para o ranking.
 *  Pré-filtra por valor (só candidatos que o valor já não descartaria) e só
 *  aciona a IA quando permitido, ligado na regra e o caso é ambíguo (>1
 *  candidato) — o léxico local roda sempre e de graça. Sem peso na regra ⇒
 *  undefined (score idêntico ao histórico). */
async function similaritiesFor(
  memo: string | null, cands: SemanticCandidate[], rule: MatchRule, allowAi: boolean,
): Promise<Map<string, number> | undefined> {
  if ((rule.descriptionWeight ?? 0) <= 0 || cands.length === 0) return undefined;
  const useAi = allowAi && Boolean(rule.useAiMatching) && cands.length > 1;
  return scoreDescriptions(memo, cands, { useAi });
}

function toTxForMatch(row: typeof importedTransactions.$inferSelect): TxForMatch {
  return {
    id: row.id, source: row.source as TxForMatch['source'],
    occurredAt: row.occurred_at, nsu: row.nsu, authorizationCode: row.authorization_code,
    grossAmount: row.gross_amount != null ? toNumber(row.gross_amount) : null,
    netAmount: row.net_amount != null ? toNumber(row.net_amount) : null,
    amount: row.amount != null ? toNumber(row.amount) : null,
    memo: row.memo,
  };
}

async function loadCandidates(tenantId: string, db: DrizzleDB): Promise<ReceivableCandidate[]> {
  const rows = await db.select({
    id: receivables.id, amount: receivables.amount, due_date: receivables.due_date,
    description: receivables.description, pos_sale_id: receivables.pos_sale_id,
  }).from(receivables)
    .where(and(eq(receivables.tenant_id, tenantId), inArray(receivables.status, ['pending', 'partial'])));
  return rows.map((r) => ({
    id: r.id, amount: toNumber(r.amount), dueDate: r.due_date,
    description: r.description, posSaleId: r.pos_sale_id,
  }));
}

async function setTxStatus(txId: string, status: string, db: DrizzleDB): Promise<void> {
  await db.update(importedTransactions).set({ reconciliation_status: status })
    .where(eq(importedTransactions.id, txId));
}

/** Contas a pagar abertas (saldo = amount − paid_amount) + CNPJ do fornecedor. */
async function loadPayableCandidates(tenantId: string, db: DrizzleDB): Promise<PayableCandidate[]> {
  const rows = await db.select({
    id: payables.id, amount: payables.amount, paid_amount: payables.paid_amount,
    due_date: payables.due_date, description: payables.description,
    supplier_cnpj: suppliers.cnpj,
  }).from(payables)
    .leftJoin(suppliers, eq(suppliers.id, payables.supplier_id))
    .where(and(eq(payables.tenant_id, tenantId), inArray(payables.status, ['pending', 'partial'])));
  return rows.map((r) => ({
    id: r.id,
    openAmount: Math.round((toNumber(r.amount) - toNumber(r.paid_amount)) * 100) / 100,
    dueDate: r.due_date, description: r.description,
    supplierDocument: r.supplier_cnpj ? r.supplier_cnpj.replace(/\D/g, '') : null,
  }));
}

/** payment_method da transação quando válido para payable_payments; senão 'other'. */
function payableMethodFor(row: typeof importedTransactions.$inferSelect): PayableMethod {
  const m = (row.payment_method ?? '').toLowerCase();
  return (VALID_PAYABLE_METHODS as readonly string[]).includes(m) ? (m as PayableMethod) : 'other';
}

/** Espelho de confirmInternal para DÉBITO ↔ conta a pagar. */
async function confirmPayableInternal(
  tenantId: string, companyId: string, row: typeof importedTransactions.$inferSelect,
  target: { payableId: string; amount: number; score: number; matchedKeys: string[] },
  method: 'auto' | 'manual', actorUserId: string | null, db: DrizzleDB,
) {
  const dedup = matchDedupKey(row.id, 'payable', target.payableId);
  let match;
  try {
    [match] = await db.insert(reconciliationMatches).values({
      tenant_id: tenantId, company_id: companyId, imported_transaction_id: row.id,
      target_type: 'payable', target_id: target.payableId, payable_id: target.payableId,
      amount_matched: toDecimalString(target.amount), score: String(target.score),
      matched_keys: target.matchedKeys, match_method: method, status: 'confirmed',
      dedup_key: dedup, matched_by: actorUserId, confirmed_at: new Date(),
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return null; // já conciliado (idempotência)
    throw err;
  }

  const { payment } = await registerPayablePayment({
    tenantId, payableId: target.payableId,
    paymentDate: (row.occurred_at ?? new Date()).toISOString().slice(0, 10),
    amount: target.amount, paymentMethod: payableMethodFor(row),
    reference: row.memo?.slice(0, 100) ?? null,
    notes: `Conciliação ${method === 'auto' ? 'automática' : 'manual'} (débito bancário)`,
    createdBy: actorUserId,
  }, db);

  await db.update(reconciliationMatches).set({ payable_payment_id: payment.id })
    .where(eq(reconciliationMatches.id, match.id));
  await setTxStatus(row.id, 'matched', db);

  await recordFiscalEvent({
    tenantId, companyId, aggregateType: 'reconciliation', aggregateId: match.id,
    eventType: 'match_confirmed', actorUserId,
    requestPayload: { tx_id: row.id, payable_id: target.payableId, method, score: target.score, keys: target.matchedKeys },
    idempotencyKey: `match_confirmed:${dedup}`,
  }, db);
  return match;
}

/** Confirma um match: pagamento + match confirmed + writeback — atômico p/ o chamador. */
async function confirmInternal(
  tenantId: string, companyId: string, tx: TxForMatch,
  target: { receivableId: string; amount: number; score: number; matchedKeys: string[] },
  method: 'auto' | 'manual', actorUserId: string | null, db: DrizzleDB,
) {
  const dedup = matchDedupKey(tx.id, 'receivable', target.receivableId);
  let match;
  try {
    [match] = await db.insert(reconciliationMatches).values({
      tenant_id: tenantId, company_id: companyId, imported_transaction_id: tx.id,
      target_type: 'receivable', target_id: target.receivableId, receivable_id: target.receivableId,
      amount_matched: toDecimalString(target.amount), score: String(target.score),
      matched_keys: target.matchedKeys, match_method: method, status: 'confirmed',
      dedup_key: dedup, matched_by: actorUserId, confirmed_at: new Date(),
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return null; // já conciliado (idempotência)
    throw err;
  }

  const paymentMethod = tx.source === 'bank' ? 'pix' : 'credit_card';
  const { payment } = await registerReceivablePayment({
    tenantId, receivableId: target.receivableId,
    paymentDate: (tx.occurredAt ?? new Date()).toISOString().slice(0, 10),
    amount: target.amount, paymentMethod,
    reference: tx.nsu ?? tx.authorizationCode ?? null,
    notes: `Conciliação ${method === 'auto' ? 'automática' : 'manual'} (transação importada)`,
    createdBy: actorUserId,
  }, db);

  await db.update(reconciliationMatches).set({ receivable_payment_id: payment.id })
    .where(eq(reconciliationMatches.id, match.id));
  await setTxStatus(tx.id, 'matched', db);

  await recordFiscalEvent({
    tenantId, companyId, aggregateType: 'reconciliation', aggregateId: match.id,
    eventType: 'match_confirmed', actorUserId,
    requestPayload: { tx_id: tx.id, receivable_id: target.receivableId, method, score: target.score, keys: target.matchedKeys },
    idempotencyKey: `match_confirmed:${dedup}`,
  }, db);
  return match;
}

export interface RunResult { processed: number; autoConfirmed: number; suggested: number; unmatched: number }

export async function runReconciliation(
  tenantId: string, opts: { companyId?: string; transactionIds?: string[] } = {}, db: DrizzleDB = _db,
): Promise<RunResult> {
  const conditions = [
    eq(importedTransactions.tenant_id, tenantId),
    eq(importedTransactions.reconciliation_status, 'pending'),
  ];
  if (opts.companyId) conditions.push(eq(importedTransactions.company_id, opts.companyId));
  if (opts.transactionIds?.length) conditions.push(inArray(importedTransactions.id, opts.transactionIds));

  const txRows = await db.select().from(importedTransactions).where(and(...conditions)).limit(500);
  if (txRows.length === 0) return { processed: 0, autoConfirmed: 0, suggested: 0, unmatched: 0 };

  const candidates = await loadCandidates(tenantId, db);
  const payableCandidates = await loadPayableCandidates(tenantId, db);
  const taken = new Set<string>(); // 1 receivable não pode ser auto-confirmado 2x na mesma rodada
  const takenPayables = new Set<string>();
  let autoConfirmed = 0, suggested = 0, unmatched = 0;

  for (const row of txRows) {
    const rule = await getRule(tenantId, row.company_id, db);
    const tx = toTxForMatch(row);

    // DÉBITO bancário (Tesouraria 0082): concilia contra contas a pagar —
    // sinal forte é o documento da contraparte (receiver do Open Finance),
    // que a normalização grava em customer_document.
    if (txDebitAmount(tx) !== null) {
      const txDebit = { ...tx, counterpartDocument: row.customer_document };
      const freeP = payableCandidates.filter((c) => !takenPayables.has(c.id));
      const valueP = freeP.filter((c) => payableValueCompatible(txDebit, c, rule));
      const simsP = await similaritiesFor(row.memo, valueP, rule, true);
      const rankedP = rankPayableCandidates(txDebit, freeP, rule, simsP);
      const outcomeP = decidePayableOutcome(rankedP, rule);

      if (outcomeP.kind === 'auto_confirm') {
        const match = await confirmPayableInternal(tenantId, row.company_id, row, {
          payableId: outcomeP.best.payableId, amount: outcomeP.best.amountMatched,
          score: outcomeP.best.score, matchedKeys: outcomeP.best.matchedKeys,
        }, 'auto', null, db);
        if (match) { takenPayables.add(outcomeP.best.payableId); autoConfirmed++; continue; }
      }
      if (outcomeP.kind !== 'unmatched') {
        const best = outcomeP.best;
        try {
          await db.insert(reconciliationMatches).values({
            tenant_id: tenantId, company_id: row.company_id, imported_transaction_id: row.id,
            target_type: 'payable', target_id: best.payableId, payable_id: best.payableId,
            amount_matched: toDecimalString(best.amountMatched), score: String(best.score),
            matched_keys: best.matchedKeys, match_method: 'auto', status: 'suggested',
            dedup_key: matchDedupKey(row.id, 'payable', best.payableId),
          });
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
        }
        suggested++;
      } else {
        await setTxStatus(row.id, 'unmatched', db);
        unmatched++;
      }
      continue;
    }

    const freeCands = candidates.filter((c) => !taken.has(c.id));
    const valueCands = freeCands.filter((c) => valueCompatible(tx, c, rule));
    const sims = await similaritiesFor(tx.memo, valueCands, rule, true);
    const ranked = rankCandidates(tx, freeCands, rule, sims);
    const outcome = decideOutcome(ranked, rule);

    if (outcome.kind === 'auto_confirm') {
      const match = await confirmInternal(tenantId, row.company_id, tx, {
        receivableId: outcome.best.receivableId, amount: outcome.best.amountMatched,
        score: outcome.best.score, matchedKeys: outcome.best.matchedKeys,
      }, 'auto', null, db);
      if (match) { taken.add(outcome.best.receivableId); autoConfirmed++; continue; }
    }
    if (outcome.kind !== 'unmatched') {
      const best = outcome.best;
      try {
        await db.insert(reconciliationMatches).values({
          tenant_id: tenantId, company_id: row.company_id, imported_transaction_id: row.id,
          target_type: 'receivable', target_id: best.receivableId, receivable_id: best.receivableId,
          amount_matched: toDecimalString(best.amountMatched), score: String(best.score),
          matched_keys: best.matchedKeys, match_method: 'auto', status: 'suggested',
          dedup_key: matchDedupKey(row.id, 'receivable', best.receivableId),
        });
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
      }
      suggested++;
    } else {
      await setTxStatus(row.id, 'unmatched', db); // fila "Pendente de Conciliação"
      unmatched++;
    }
  }

  return { processed: txRows.length, autoConfirmed, suggested, unmatched };
}

/** Confirmação manual (fila de pendências), 1↔1 — receivable OU payable. */
export async function confirmMatchManual(
  tenantId: string, txId: string,
  target: { receivableId?: string; payableId?: string },
  actorUserId: string, db: DrizzleDB = _db,
) {
  const [row] = await db.select().from(importedTransactions)
    .where(and(eq(importedTransactions.id, txId), eq(importedTransactions.tenant_id, tenantId)));
  if (!row) throw new ReconciliationDomainError('transaction_not_found', { txId });
  if (row.reconciliation_status === 'matched') throw new ReconciliationDomainError('already_matched');
  const txCompetencia = (row.occurred_at ?? row.created_at).toISOString().slice(0, 7);
  await assertCompetenciaAberta(tenantId, row.company_id, txCompetencia, db);

  if (target.payableId) {
    const [cand] = await db.select().from(payables)
      .where(and(eq(payables.id, target.payableId), eq(payables.tenant_id, tenantId)));
    if (!cand) throw new ReconciliationDomainError('payable_not_found', { payableId: target.payableId });
    const openAmount = Math.round((toNumber(cand.amount) - toNumber(cand.paid_amount)) * 100) / 100;
    const match = await confirmPayableInternal(tenantId, row.company_id, row, {
      payableId: target.payableId, amount: openAmount, score: 1, matchedKeys: ['manual'],
    }, 'manual', actorUserId, db);
    if (!match) throw new ReconciliationDomainError('already_matched');
    return match;
  }

  if (!target.receivableId) throw new ReconciliationDomainError('receivable_not_found', {});
  const [cand] = await db.select().from(receivables)
    .where(and(eq(receivables.id, target.receivableId), eq(receivables.tenant_id, tenantId)));
  if (!cand) throw new ReconciliationDomainError('receivable_not_found', { receivableId: target.receivableId });

  const tx = toTxForMatch(row);
  const match = await confirmInternal(tenantId, row.company_id, tx, {
    receivableId: target.receivableId, amount: toNumber(cand.amount), score: 1, matchedKeys: ['manual'],
  }, 'manual', actorUserId, db);
  if (!match) throw new ReconciliationDomainError('already_matched');
  return match;
}

export async function ignoreTransaction(tenantId: string, txId: string, actorUserId: string, db: DrizzleDB = _db) {
  const [row] = await db.select().from(importedTransactions)
    .where(and(eq(importedTransactions.id, txId), eq(importedTransactions.tenant_id, tenantId)));
  if (!row) throw new ReconciliationDomainError('transaction_not_found', { txId });
  if (row.reconciliation_status === 'matched') throw new ReconciliationDomainError('already_matched');
  await setTxStatus(txId, 'ignored', db);
  await recordFiscalEvent({
    tenantId, companyId: row.company_id, aggregateType: 'reconciliation', aggregateId: row.id,
    eventType: 'transaction_ignored', actorUserId,
  }, db);
}

/** Lista candidatos ranqueados para resolução manual — crédito devolve
 *  receivables ({receivableId}), débito devolve contas a pagar ({payableId}). */
export async function listCandidatesFor(tenantId: string, txId: string, db: DrizzleDB = _db) {
  const [row] = await db.select().from(importedTransactions)
    .where(and(eq(importedTransactions.id, txId), eq(importedTransactions.tenant_id, tenantId)));
  if (!row) throw new ReconciliationDomainError('transaction_not_found', { txId });
  const rule = await getRule(tenantId, row.company_id, db);
  // Janela manual mais generosa: tolerância ampliada ajuda o humano a decidir.
  const wide: MatchRule = { ...rule, amountTolerance: Math.max(rule.amountTolerance, 1), dateWindowDays: Math.max(rule.dateWindowDays, 15) };
  const tx = toTxForMatch(row);
  if (txDebitAmount(tx) !== null) {
    const txDebit = { ...tx, counterpartDocument: row.customer_document };
    const cands = await loadPayableCandidates(tenantId, db);
    // Léxico local só (allowAi=false): sem custo de IA ao abrir a lista.
    const sims = await similaritiesFor(row.memo, cands.filter((c) => payableValueCompatible(txDebit, c, wide)), wide, false);
    return rankPayableCandidates(txDebit, cands, wide, sims).slice(0, 20);
  }
  const cands = await loadCandidates(tenantId, db);
  const sims = await similaritiesFor(tx.memo, cands.filter((c) => valueCompatible(tx, c, wide)), wide, false);
  return rankCandidates(tx, cands, wide, sims).slice(0, 20);
}

export async function reconciliationSummary(tenantId: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<{ reconciliation_status: string; count: string }>(
    sql`SELECT reconciliation_status, COUNT(*) AS count FROM imported_transactions
        WHERE tenant_id = ${tenantId} GROUP BY reconciliation_status`
  );
  return Object.fromEntries(rows.map((r) => [r.reconciliation_status, Number(r.count)]));
}
