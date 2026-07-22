// Conciliação (0072): scoring puro (NSU/valor/data, tolerância, ambiguidade)
// e REGRESSÃO do registerReceivablePayment extraído de routes/receivables.ts
// (mesma matemática de flip pending→partial/paid).

import { describe, it, expect, vi } from 'vitest';
import {
  scoreCandidate, rankCandidates, decideOutcome, txAmount, valueCompatible,
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

describe('similaridade de descrição no scoring (0090)', () => {
  // memo bancário sem NSU/autorização — só valor + data + descrição pontuam.
  const BANK: TxForMatch = {
    id: 'b1', source: 'bank', occurredAt: new Date('2026-07-03T12:00:00'),
    nsu: null, authorizationCode: null, grossAmount: null, netAmount: null,
    amount: 150, memo: 'PIX RECEBIDO PADARIA DO JOAO',
  };
  const RULE_SEM: MatchRule = { ...RULE, descriptionWeight: 0.25 };
  const rc = (over: Partial<ReceivableCandidate>): ReceivableCandidate =>
    ({ id: 'r1', amount: 150, dueDate: '2026-07-03', description: null, posSaleId: null, ...over });

  it('retrocompatível: sem similaridade o score é idêntico ao histórico', () => {
    const withUndef = scoreCandidate(BANK, rc({}), RULE_SEM);
    const noArg = scoreCandidate(BANK, rc({}), RULE_SEM);
    const legacyRule = scoreCandidate(BANK, rc({}), RULE); // sem descriptionWeight
    expect(withUndef!.score).toBe(noArg!.score);
    expect(withUndef!.score).toBe(legacyRule!.score);
    expect(withUndef!.matchedKeys).not.toContain('description_semantic');
  });

  it('peso 0 (ou regra sem peso) anula a contribuição semântica', () => {
    const zero = scoreCandidate(BANK, rc({}), { ...RULE, descriptionWeight: 0 }, 0.95);
    const base = scoreCandidate(BANK, rc({}), RULE);
    expect(zero!.score).toBe(base!.score);
    expect(zero!.matchedKeys).not.toContain('description_semantic');
  });

  it('similaridade alta soma peso×sim e marca a chave description_semantic', () => {
    const base = scoreCandidate(BANK, rc({}), RULE_SEM)!;
    const sem = scoreCandidate(BANK, rc({}), RULE_SEM, 0.8)!;
    expect(sem.score).toBeCloseTo(Math.min(1, base.score + 0.25 * 0.8), 4);
    expect(sem.matchedKeys).toContain('description_semantic');
  });

  it('similaridade abaixo do piso soma pouco mas NÃO marca a chave', () => {
    const sem = scoreCandidate(BANK, rc({}), RULE_SEM, 0.3)!;
    expect(sem.matchedKeys).not.toContain('description_semantic');
  });

  it('desempata dois candidatos de mesmo valor/data pela descrição → auto_confirm', () => {
    const sims = new Map<string, number>([['a', 0.9], ['b', 0.05]]);
    const ranked = rankCandidates(BANK, [rc({ id: 'a' }), rc({ id: 'b' })], RULE_SEM, sims);
    expect(ranked[0].receivableId).toBe('a');
    const outcome = decideOutcome(ranked, RULE_SEM);
    expect(outcome.kind).toBe('auto_confirm');
    if (outcome.kind === 'auto_confirm') expect(outcome.best.receivableId).toBe('a');
  });

  it('valueCompatible espelha a porteira de valor de scoreCandidate', () => {
    expect(valueCompatible(BANK, rc({ amount: 150 }), RULE)).toBe(true);
    expect(valueCompatible(BANK, rc({ amount: 150.005 }), RULE)).toBe(true); // dentro da tolerância
    expect(valueCompatible(BANK, rc({ amount: 149 }), RULE)).toBe(false);
    expect(valueCompatible({ ...BANK, amount: -150 }, rc({}), RULE)).toBe(false); // débito não concilia receita
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
