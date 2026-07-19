// Débito bancário ↔ conta a pagar (Tesouraria 0082) — scoring puro. Os
// invariantes que impedem pagamento errado: crédito NUNCA vira candidato a
// payable, valor incompatível descarta, documento do fornecedor é o sinal
// forte, e o desfecho exige score alto SEM empate.

import { describe, it, expect } from 'vitest';
import {
  txDebitAmount, scorePayableCandidate, rankPayableCandidates, decidePayableOutcome,
  MatchRule, TxForMatch, PayableCandidate,
} from '../domain/reconciliation/reconciliationDomain';

const RULE: MatchRule = { amountTolerance: 0.01, dateWindowDays: 3, autoConfirmThreshold: 0.9, matchNetAmount: true };

const debit = (over: Partial<TxForMatch> = {}): TxForMatch & { counterpartDocument?: string | null } => ({
  id: 'tx-1', source: 'bank', occurredAt: new Date('2026-07-15T12:00:00Z'),
  nsu: null, authorizationCode: null, grossAmount: null, netAmount: null,
  amount: -39.9, memo: 'TARIFA', ...over,
});

const payable = (over: Partial<PayableCandidate> = {}): PayableCandidate => ({
  id: 'pay-1', openAmount: 39.9, dueDate: '2026-07-15',
  supplierDocument: '99888777000166', description: 'Tarifa bancária', ...over,
});

describe('txDebitAmount', () => {
  it('débito bancário → valor absoluto; crédito e não-banco → null', () => {
    expect(txDebitAmount(debit())).toBe(39.9);
    expect(txDebitAmount(debit({ amount: 350 }))).toBeNull();
    expect(txDebitAmount(debit({ source: 'acquirer' as const }))).toBeNull();
    expect(txDebitAmount(debit({ amount: null }))).toBeNull();
  });
});

describe('scorePayableCandidate', () => {
  it('valor exato + vencimento no dia = 0.9 (auto-confirma no threshold default)', () => {
    const s = scorePayableCandidate(debit(), payable({ supplierDocument: null }), RULE);
    expect(s?.score).toBe(0.9);
    expect(s?.matchedKeys).toEqual(['amount_exact', 'date_window']);
  });

  it('documento do fornecedor batendo é o sinal forte (+0.6, capado em 1)', () => {
    const s = scorePayableCandidate(
      debit({ counterpartDocument: '99888777000166' } as any), payable(), RULE);
    expect(s?.score).toBe(1);
    expect(s?.matchedKeys).toContain('supplier_document');
  });

  it('valor fora da tolerância descarta o candidato', () => {
    expect(scorePayableCandidate(debit(), payable({ openAmount: 45 }), RULE)).toBeNull();
  });

  it('usa o saldo ABERTO (pagamento parcial já abatido), não o valor original', () => {
    // payable de 100 com 60.10 pago → saldo 39.90 casa com o débito de 39.90
    const s = scorePayableCandidate(debit(), payable({ openAmount: 39.9 }), RULE);
    expect(s?.matchedKeys).toContain('amount_exact');
  });

  it('crédito nunca pontua contra payable', () => {
    expect(scorePayableCandidate(debit({ amount: 39.9 }), payable(), RULE)).toBeNull();
  });
});

describe('decidePayableOutcome', () => {
  it('empate no topo NUNCA auto-confirma (vira sugestão)', () => {
    const tx = debit({ occurredAt: null }); // sem data: só o valor pontua (0.5)
    const wide: MatchRule = { ...RULE, autoConfirmThreshold: 0.5 };
    const ranked = rankPayableCandidates(tx, [
      payable({ id: 'a', supplierDocument: null }),
      payable({ id: 'b', supplierDocument: null }),
    ], wide);
    expect(ranked).toHaveLength(2);
    expect(decidePayableOutcome(ranked, wide).kind).toBe('suggest');
  });

  it('score alto sem empate → auto_confirm', () => {
    const ranked = rankPayableCandidates(
      debit({ counterpartDocument: '99888777000166' } as any),
      [payable(), payable({ id: 'other', openAmount: 500 })], RULE);
    const outcome = decidePayableOutcome(ranked, RULE);
    expect(outcome.kind).toBe('auto_confirm');
    if (outcome.kind === 'auto_confirm') expect(outcome.best.payableId).toBe('pay-1');
  });
});
