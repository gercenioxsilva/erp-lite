// Conciliação (0072): scoring puro (NSU/valor/data, tolerância, ambiguidade)
// e REGRESSÃO do registerReceivablePayment extraído de routes/receivables.ts
// (mesma matemática de flip pending→partial/paid).

import { describe, it, expect, vi } from 'vitest';
import {
  scoreCandidate, rankCandidates, decideOutcome, txAmount,
  TxForMatch, ReceivableCandidate, MatchRule,
} from '../domain/reconciliation/reconciliationDomain';
import { registerReceivablePayment, ReceivablePaymentError } from '../services/receivableService';

const RULE: MatchRule = { amountTolerance: 0.01, dateWindowDays: 3, autoConfirmThreshold: 0.9, matchNetAmount: true };

const TX: TxForMatch = {
  id: 'tx1', source: 'acquirer', occurredAt: new Date('2026-07-02T12:00:00'),
  nsu: '001234', authorizationCode: 'AUT01', grossAmount: 100, netAmount: 97.5, amount: null, memo: null,
};

const cand = (over: Partial<ReceivableCandidate>): ReceivableCandidate => ({
  id: 'r1', amount: 97.5, dueDate: '2026-07-03', description: 'Venda PDV — adquirente', posSaleId: null, ...over,
});

describe('scoring de conciliação', () => {
  it('usa líquido p/ adquirente e só créditos p/ banco', () => {
    expect(txAmount(TX, RULE)).toBe(97.5);
    expect(txAmount({ ...TX, source: 'bank', amount: 150 }, RULE)).toBe(150);
    expect(txAmount({ ...TX, source: 'bank', amount: -50 }, RULE)).toBeNull(); // débito não concilia receita
  });

  it('valor exato + data na janela pontua alto; NSU na descrição = quase certo', () => {
    const plain = scoreCandidate(TX, cand({}), RULE)!;
    expect(plain.score).toBeGreaterThanOrEqual(0.75);
    expect(plain.matchedKeys).toContain('amount_exact');
    expect(plain.matchedKeys).toContain('date_window');

    const withNsu = scoreCandidate(TX, cand({ description: 'Venda NSU 001234' }), RULE)!;
    expect(withNsu.score).toBeGreaterThan(plain.score);
    expect(withNsu.matchedKeys).toContain('nsu');
  });

  it('valor incompatível descarta o candidato', () => {
    expect(scoreCandidate(TX, cand({ amount: 80 }), RULE)).toBeNull();
  });

  it('decideOutcome: auto-confirma só sem empate; ambíguo vira sugestão', () => {
    const ranked = rankCandidates(TX, [cand({ id: 'a' }), cand({ id: 'b' })], RULE);
    expect(ranked).toHaveLength(2);
    expect(decideOutcome(ranked, RULE).kind).toBe('suggest'); // empate no topo
    const single = rankCandidates(TX, [cand({ id: 'a', description: 'NSU 001234' })], RULE);
    expect(decideOutcome(single, RULE).kind).toBe('auto_confirm');
    expect(decideOutcome([], RULE).kind).toBe('unmatched');
  });
});

describe('registerReceivablePayment (regressão da extração)', () => {
  const makeDb = (rec: any) => {
    const inserted = { id: 'pay1' };
    const updates: any[] = [];
    const txApi = {
      insert: vi.fn(() => ({ values: (v: any) => ({ returning: async () => { updates.push({ insert: v }); return [inserted]; } }) })),
      update: vi.fn(() => ({ set: (v: any) => ({ where: async () => { updates.push({ update: v }); } }) })),
    };
    const db: any = {
      select: vi.fn(() => ({ from: () => ({ where: async () => (rec ? [rec] : []) }) })),
      transaction: vi.fn(async (fn: any) => fn(txApi)),
    };
    return { db, updates };
  };

  const REC = { id: 'r1', status: 'pending', amount: '100.00', paid_amount: '0.00', client_id: null, description: 'x' };

  it('pagamento parcial → status partial; total → paid (mesma matemática da rota)', async () => {
    const { db, updates } = makeDb({ ...REC });
    const partial = await registerReceivablePayment({
      tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02',
      amount: 40, paymentMethod: 'pix', reference: 'NSU001', createdBy: null,
    }, db);
    expect(partial.newStatus).toBe('partial');
    expect(partial.newPaidAmount).toBe(40);
    expect(updates.find(u => u.insert)?.insert.reference).toBe('NSU001');
    expect(updates.find(u => u.update)?.update.status).toBe('partial');

    const { db: db2 } = makeDb({ ...REC, paid_amount: '60.00' });
    const full = await registerReceivablePayment({
      tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02',
      amount: 40, paymentMethod: 'pix', createdBy: 'u1',
    }, db2);
    expect(full.newStatus).toBe('paid');
    expect(full.newPaidAmount).toBe(100);
  });

  it('erros tipados preservam as validações da rota original', async () => {
    const { db } = makeDb({ ...REC });
    await expect(registerReceivablePayment({ tenantId: 't1', receivableId: 'r1', paymentDate: '', amount: 10, paymentMethod: 'pix', createdBy: null }, db))
      .rejects.toMatchObject({ code: 'payment_date_required' });
    await expect(registerReceivablePayment({ tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02', amount: 0, paymentMethod: 'pix', createdBy: null }, db))
      .rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(registerReceivablePayment({ tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02', amount: 10, paymentMethod: 'dinheiro-vivo', createdBy: null }, db))
      .rejects.toMatchObject({ code: 'invalid_method' });

    const { db: dbNone } = makeDb(null);
    await expect(registerReceivablePayment({ tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02', amount: 10, paymentMethod: 'pix', createdBy: null }, dbNone))
      .rejects.toBeInstanceOf(ReceivablePaymentError);

    const { db: dbCancelled } = makeDb({ ...REC, status: 'cancelled' });
    await expect(registerReceivablePayment({ tenantId: 't1', receivableId: 'r1', paymentDate: '2026-07-02', amount: 10, paymentMethod: 'pix', createdBy: null }, dbCancelled))
      .rejects.toMatchObject({ code: 'receivable_cancelled' });
  });
});
