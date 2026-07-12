// Motor contábil — regras PURAS de partidas dobradas.
// Correções fiscais do Simples EMBUTIDAS (e testadas, não comentadas):
//   - ISS do optante está DENTRO do DAS: a nota NÃO lança ISS a recolher;
//     só ISS RETIDO NA FONTE vira ativo compensável e reduz Clientes;
//   - regime CAIXA: autorização de nota não posta; o recebimento reconhece a
//     receita direto (valor já líquido de retenção — sem linha de retido);
//   - recebimento SEM autorização prévia (POS sem NFC-e, OS sem NFS-e) no
//     regime competência reconhece D-Caixa/C-Receita direto (senão Clientes
//     ficaria negativo e a receita sumiria do DRE contábil);
//   - DAS lança na competência da APURAÇÃO, não a do pagamento;
//   - CPP Anexo IV e ICMS/ISS de sublimite ficam FORA do DAS (contas próprias
//     p/ lançamento manual — exclusão automática documentada).

import { round2 } from '../../lib/money';

export class AccountingDomainError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AccountingDomainError';
  }
}

export type Regime = 'caixa' | 'competencia';
export type Side = 'debit' | 'credit';

export interface LineSpec {
  accountKey: string;   // system_key do plano de contas
  side: Side;
  amount: number;
}

export interface EntryDraft {
  entryDate: string;      // YYYY-MM-DD
  competencia: string;    // YYYY-MM
  description: string;
  lines: LineSpec[];
}

/** Valida partidas dobradas: >=2 linhas, valores >0, SUM(D)=SUM(C). */
export function validateEntry(draft: EntryDraft): void {
  const lines = draft.lines.filter((l) => l.amount > 0);
  if (lines.length < 2) throw new AccountingDomainError('empty_entry');
  const d = round2(lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0));
  const c = round2(lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0));
  if (d !== c) throw new AccountingDomainError('unbalanced_entry', { debit: d, credit: c });
}

/* ── Posting rules por (source_type, regime) ───────────────────────────── */

export interface RevenueFact {
  kind: 'invoice' | 'nfse';
  gross: number;
  issRetido: number;        // retido na fonte pelo tomador (0 se não)
}

/** Autorização de nota — SÓ regime competência posta. */
export function linesForAuthorization(fact: RevenueFact, regime: Regime): LineSpec[] {
  if (regime === 'caixa') return []; // caixa reconhece no recebimento
  const receita = fact.kind === 'nfse' ? 'receita_servicos' : 'receita_vendas';
  const lines: LineSpec[] = [
    { accountKey: 'clientes', side: 'debit', amount: round2(fact.gross - fact.issRetido) },
    { accountKey: receita, side: 'credit', amount: fact.gross },
  ];
  if (fact.issRetido > 0) {
    lines.splice(1, 0, { accountKey: 'impostos_retidos', side: 'debit', amount: fact.issRetido });
  }
  return lines;
}

export interface ReceivablePaymentFact {
  amount: number;
  viaBank: boolean;              // pix/transfer/boleto → bancos; dinheiro → caixa
  hasPriorAuthorization: boolean; // já houve entry de autorização deste doc?
  serviceRevenue: boolean;        // fallback sem doc: serviço (default) ou venda
}

export function linesForReceivablePayment(fact: ReceivablePaymentFact, regime: Regime): LineSpec[] {
  const cashKey = fact.viaBank ? 'bancos' : 'caixa';
  // Caixa: sempre receita direta. Competência: baixa Clientes SE houve
  // autorização; sem doc fiscal prévio, receita direta (furo corrigido).
  const contra = regime === 'competencia' && fact.hasPriorAuthorization
    ? 'clientes'
    : (fact.serviceRevenue ? 'receita_servicos' : 'receita_vendas');
  return [
    { accountKey: cashKey, side: 'debit', amount: fact.amount },
    { accountKey: contra, side: 'credit', amount: fact.amount },
  ];
}

export function linesForPayablePayment(fact: { amount: number; expenseKey: string }): LineSpec[] {
  return [
    { accountKey: fact.expenseKey, side: 'debit', amount: fact.amount },
    { accountKey: 'bancos', side: 'credit', amount: fact.amount },
  ];
}

export function linesForDasPayment(fact: { amount: number }): LineSpec[] {
  return [
    { accountKey: 'despesa_simples', side: 'debit', amount: fact.amount },
    { accountKey: 'bancos', side: 'credit', amount: fact.amount },
  ];
}

/** POS: SÓ suprimento/sangria (venda entra via receivable_payment — nunca 2×). */
export function linesForPosCashMovement(fact: { kind: 'suprimento' | 'sangria'; amount: number }): LineSpec[] {
  return fact.kind === 'suprimento'
    ? [{ accountKey: 'caixa', side: 'debit', amount: fact.amount }, { accountKey: 'bancos', side: 'credit', amount: fact.amount }]
    : [{ accountKey: 'bancos', side: 'debit', amount: fact.amount }, { accountKey: 'caixa', side: 'credit', amount: fact.amount }];
}

/** De-para dre_categories (0042) → system_key de conta de despesa. */
export const DRE_TO_ACCOUNT: Record<string, string> = {
  cmv: 'cmv', csp: 'cmv', pessoal: 'despesa_pessoal', aluguel: 'despesa_aluguel',
  utilidades: 'despesa_utilidades', marketing: 'despesa_marketing', admin: 'despesa_admin',
  tributaria: 'despesa_tributaria', irpj_csll: 'despesa_tributaria',
  despesa_financeira: 'despesa_financeira', outras_despesas: 'despesa_outras',
};

/* ── Relatórios derivados ──────────────────────────────────────────────── */

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  nature: string;
  normalBalance: Side;
  debit: number;
  credit: number;
}

export interface BalanceteLine extends AccountBalanceRow {
  saldo: number; // positivo no saldo NORMAL da conta
}

export function computeTrialBalance(rows: AccountBalanceRow[]): { lines: BalanceteLine[]; totalDebit: number; totalCredit: number; fecha: boolean } {
  const lines = rows.map((r) => ({
    ...r,
    saldo: round2(r.normalBalance === 'debit' ? r.debit - r.credit : r.credit - r.debit),
  }));
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return { lines, totalDebit, totalCredit, fecha: totalDebit === totalCredit };
}

export function computeBalanceSheet(rows: AccountBalanceRow[]): {
  ativo: number; passivo: number; pl: number; resultadoPeriodo: number; fecha: boolean;
} {
  const saldo = (r: AccountBalanceRow) => (r.normalBalance === 'debit' ? r.debit - r.credit : r.credit - r.debit);
  const sum = (nature: string) => round2(rows.filter((r) => r.nature === nature).reduce((s, r) => s + saldo(r), 0));
  const ativo = sum('ativo');
  const passivo = sum('passivo');
  const pl = sum('pl');
  const resultadoPeriodo = round2(sum('receita') - sum('despesa'));
  return { ativo, passivo, pl, resultadoPeriodo, fecha: round2(ativo) === round2(passivo + pl + resultadoPeriodo) };
}
