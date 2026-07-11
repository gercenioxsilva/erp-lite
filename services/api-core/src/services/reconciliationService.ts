// Motor de conciliação (0072) — camada de serviço.
// runReconciliation: varre imported_transactions 'pending' → ranqueia
// receivables candidatos (inclui os POS 'pending — adquirente') → auto-confirma
// acima do threshold ou sugere (fila "Pendente de Conciliação").
// Confirmação = registerReceivablePayment (reference=NSU/FITID) + match
// 'confirmed' + writeback do reconciliation_status — este serviço é o ÚNICO
// escritor desse status. Tudo auditado em fiscal_events.

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { importedTransactions, reconciliationMatches, reconciliationRules, receivables } from '../db/schema';
import { registerReceivablePayment } from './receivableService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toNumber, toDecimalString } from '../lib/money';
import {
  TxForMatch, ReceivableCandidate, MatchRule, rankCandidates, decideOutcome,
  matchDedupKey, ReconciliationDomainError,
} from '../domain/reconciliation/reconciliationDomain';

export type DrizzleDB = typeof _db;

const DEFAULT_RULE: MatchRule = { amountTolerance: 0.01, dateWindowDays: 3, autoConfirmThreshold: 0.9, matchNetAmount: true };

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
  };
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
  const taken = new Set<string>(); // 1 receivable não pode ser auto-confirmado 2x na mesma rodada
  let autoConfirmed = 0, suggested = 0, unmatched = 0;

  for (const row of txRows) {
    const rule = await getRule(tenantId, row.company_id, db);
    const tx = toTxForMatch(row);
    const ranked = rankCandidates(tx, candidates.filter((c) => !taken.has(c.id)), rule);
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

/** Confirmação manual (fila de pendências), 1↔1. */
export async function confirmMatchManual(
  tenantId: string, txId: string, receivableId: string, actorUserId: string, db: DrizzleDB = _db,
) {
  const [row] = await db.select().from(importedTransactions)
    .where(and(eq(importedTransactions.id, txId), eq(importedTransactions.tenant_id, tenantId)));
  if (!row) throw new ReconciliationDomainError('transaction_not_found', { txId });
  if (row.reconciliation_status === 'matched') throw new ReconciliationDomainError('already_matched');

  const [cand] = await db.select().from(receivables)
    .where(and(eq(receivables.id, receivableId), eq(receivables.tenant_id, tenantId)));
  if (!cand) throw new ReconciliationDomainError('receivable_not_found', { receivableId });

  const tx = toTxForMatch(row);
  const match = await confirmInternal(tenantId, row.company_id, tx, {
    receivableId, amount: toNumber(cand.amount), score: 1, matchedKeys: ['manual'],
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

/** Lista candidatos ranqueados para resolução manual. */
export async function listCandidatesFor(tenantId: string, txId: string, db: DrizzleDB = _db) {
  const [row] = await db.select().from(importedTransactions)
    .where(and(eq(importedTransactions.id, txId), eq(importedTransactions.tenant_id, tenantId)));
  if (!row) throw new ReconciliationDomainError('transaction_not_found', { txId });
  const rule = await getRule(tenantId, row.company_id, db);
  // Janela manual mais generosa: tolerância ampliada ajuda o humano a decidir.
  const wide: MatchRule = { ...rule, amountTolerance: Math.max(rule.amountTolerance, 1), dateWindowDays: Math.max(rule.dateWindowDays, 15) };
  return rankCandidates(toTxForMatch(row), await loadCandidates(tenantId, db), wide).slice(0, 20);
}

export async function reconciliationSummary(tenantId: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<{ reconciliation_status: string; count: string }>(
    sql`SELECT reconciliation_status, COUNT(*) AS count FROM imported_transactions
        WHERE tenant_id = ${tenantId} GROUP BY reconciliation_status`
  );
  return Object.fromEntries(rows.map((r) => [r.reconciliation_status, Number(r.count)]));
}
