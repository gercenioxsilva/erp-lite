// E5: correções contábeis do Simples como TESTES (não comentários):
// ISS dentro do DAS, ISS retido reduz Clientes, regime caixa vs competência,
// recebimento sem doc → receita direta, POS sem dupla contagem, partidas
// dobradas fecham.

import { describe, it, expect } from 'vitest';
import {
  validateEntry, linesForAuthorization, linesForReceivablePayment,
  linesForDasPayment, linesForPosCashMovement, computeTrialBalance,
  computeBalanceSheet, AccountingDomainError,
} from '../domain/accounting/accountingDomain';

describe('validateEntry (partidas dobradas)', () => {
  it('aceita entry balanceada e rejeita desbalanceada/vazia', () => {
    expect(() => validateEntry({
      entryDate: '2026-07-01', competencia: '2026-07', description: 'x',
      lines: [{ accountKey: 'caixa', side: 'debit', amount: 100 }, { accountKey: 'receita_servicos', side: 'credit', amount: 100 }],
    })).not.toThrow();
    expect(() => validateEntry({
      entryDate: '2026-07-01', competencia: '2026-07', description: 'x',
      lines: [{ accountKey: 'caixa', side: 'debit', amount: 100 }, { accountKey: 'receita_servicos', side: 'credit', amount: 90 }],
    })).toThrowError(AccountingDomainError);
    expect(() => validateEntry({ entryDate: '2026-07-01', competencia: '2026-07', description: 'x', lines: [] }))
      .toThrowError(AccountingDomainError);
  });
});

describe('autorização de nota (regras do Simples)', () => {
  it('optante NÃO lança ISS a recolher — nota simples: D-Clientes/C-Receita', () => {
    const lines = linesForAuthorization({ kind: 'nfse', gross: 1000, issRetido: 0 }, 'competencia');
    expect(lines).toEqual([
      { accountKey: 'clientes', side: 'debit', amount: 1000 },
      { accountKey: 'receita_servicos', side: 'credit', amount: 1000 },
    ]);
    expect(lines.some((l) => l.accountKey.includes('iss'))).toBe(false); // ISS está DENTRO do DAS
  });

  it('ISS retido na fonte reduz Clientes e vira ativo compensável (fecha a conta)', () => {
    const lines = linesForAuthorization({ kind: 'nfse', gross: 1000, issRetido: 50 }, 'competencia');
    const d = lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0);
    const c = lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0);
    expect(d).toBe(c);
    expect(lines.find((l) => l.accountKey === 'clientes')?.amount).toBe(950);
    expect(lines.find((l) => l.accountKey === 'impostos_retidos')?.amount).toBe(50);
  });

  it('regime CAIXA: autorização não posta (reconhece no recebimento)', () => {
    expect(linesForAuthorization({ kind: 'nfse', gross: 1000, issRetido: 50 }, 'caixa')).toEqual([]);
  });
});

describe('recebimento', () => {
  it('competência COM autorização prévia: baixa Clientes', () => {
    const lines = linesForReceivablePayment({ amount: 500, viaBank: true, hasPriorAuthorization: true, serviceRevenue: true }, 'competencia');
    expect(lines).toEqual([
      { accountKey: 'bancos', side: 'debit', amount: 500 },
      { accountKey: 'clientes', side: 'credit', amount: 500 },
    ]);
  });

  it('SEM doc fiscal prévio: receita direta (Clientes nunca fica negativo)', () => {
    const lines = linesForReceivablePayment({ amount: 500, viaBank: false, hasPriorAuthorization: false, serviceRevenue: true }, 'competencia');
    expect(lines).toEqual([
      { accountKey: 'caixa', side: 'debit', amount: 500 },
      { accountKey: 'receita_servicos', side: 'credit', amount: 500 },
    ]);
  });

  it('regime CAIXA: sempre receita direta no recebimento', () => {
    const lines = linesForReceivablePayment({ amount: 500, viaBank: true, hasPriorAuthorization: true, serviceRevenue: false }, 'caixa');
    expect(lines[1]).toEqual({ accountKey: 'receita_vendas', side: 'credit', amount: 500 });
  });
});

describe('DAS e POS', () => {
  it('DAS: despesa única (repartição fica na memória da apuração)', () => {
    expect(linesForDasPayment({ amount: 4040 })).toEqual([
      { accountKey: 'despesa_simples', side: 'debit', amount: 4040 },
      { accountKey: 'bancos', side: 'credit', amount: 4040 },
    ]);
  });

  it('POS: só suprimento/sangria movimentam caixa (venda via receivable_payment)', () => {
    expect(linesForPosCashMovement({ kind: 'suprimento', amount: 200 })[0].accountKey).toBe('caixa');
    expect(linesForPosCashMovement({ kind: 'sangria', amount: 200 })[0].accountKey).toBe('bancos');
  });
});

describe('balancete e balanço', () => {
  const rows = [
    { accountId: 'a1', code: '1.1.01', name: 'Caixa', nature: 'ativo', normalBalance: 'debit' as const, debit: 1000, credit: 200 },
    { accountId: 'a2', code: '2.1.02', name: 'Simples a Recolher', nature: 'passivo', normalBalance: 'credit' as const, debit: 0, credit: 300 },
    { accountId: 'a3', code: '4.1.02', name: 'Receita Serviços', nature: 'receita', normalBalance: 'credit' as const, debit: 0, credit: 800 },
    { accountId: 'a4', code: '5.1.01', name: 'DAS', nature: 'despesa', normalBalance: 'debit' as const, debit: 300, credit: 0 },
  ];

  it('balancete: total débito == total crédito', () => {
    const t = computeTrialBalance(rows);
    expect(t.totalDebit).toBe(1300);
    expect(t.totalCredit).toBe(1300);
    expect(t.fecha).toBe(true);
    expect(t.lines.find((l) => l.code === '1.1.01')?.saldo).toBe(800);
  });

  it('balanço: ativo = passivo + PL + resultado', () => {
    const b = computeBalanceSheet(rows);
    expect(b.ativo).toBe(800);
    expect(b.passivo).toBe(300);
    expect(b.resultadoPeriodo).toBe(500); // 800 receita − 300 despesa
    expect(b.fecha).toBe(true);
  });
});
