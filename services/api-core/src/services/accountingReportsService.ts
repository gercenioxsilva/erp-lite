// Relatórios contábeis — DERIVADOS do razão (queries; nenhuma tabela extra).
// Rotulagem obrigatória na UI: "DRE contábil" (dupla entrada) ≠ "DRE
// gerencial" (dreService, single-entry) — divergem por construção.

import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { journalEntries, journalLines, chartOfAccounts } from '../db/schema';
import { toNumber, round2 } from '../lib/money';
import { computeTrialBalance, computeBalanceSheet, AccountBalanceRow } from '../domain/accounting/accountingDomain';

export type DrizzleDB = typeof _db;

async function accountBalances(
  tenantId: string, filters: { from?: string; to?: string }, db: DrizzleDB,
): Promise<AccountBalanceRow[]> {
  const { rows } = await db.execute<any>(sql`
    SELECT a.id, a.code, a.name, a.nature, a.normal_balance,
           COALESCE(SUM(CASE WHEN l.side = 'debit'  THEN l.amount END), 0) AS debit,
           COALESCE(SUM(CASE WHEN l.side = 'credit' THEN l.amount END), 0) AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ${tenantId}
      ${filters.from ? sql`AND e.entry_date >= ${filters.from}` : sql``}
      ${filters.to ? sql`AND e.entry_date <= ${filters.to}` : sql``}
    GROUP BY a.id, a.code, a.name, a.nature, a.normal_balance
    ORDER BY a.code`);
  return rows.map((r: any) => ({
    accountId: r.id, code: r.code, name: r.name, nature: r.nature,
    normalBalance: r.normal_balance, debit: Number(r.debit), credit: Number(r.credit),
  }));
}

export async function balancete(tenantId: string, from: string, to: string, db: DrizzleDB = _db) {
  return computeTrialBalance(await accountBalances(tenantId, { from, to }, db));
}

export async function balanco(tenantId: string, date: string, db: DrizzleDB = _db) {
  const rows = await accountBalances(tenantId, { to: date }, db);
  const hasOpening = await db.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.tenant_id, tenantId), eq(journalEntries.source_type, 'opening_balance')))
    .limit(1);
  return { ...computeBalanceSheet(rows), hasOpeningBalance: hasOpening.length > 0, date };
}

export async function livroDiario(tenantId: string, from: string, to: string, db: DrizzleDB = _db) {
  const entries = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.tenant_id, tenantId),
      gte(journalEntries.entry_date, from), lte(journalEntries.entry_date, to)))
    .orderBy(journalEntries.entry_date, journalEntries.created_at)
    .limit(500);
  if (entries.length === 0) return { entries: [] };
  const { rows: lines } = await db.execute<any>(sql`
    SELECT l.entry_id, l.side, l.amount, l.line_order, a.code, a.name
    FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ${tenantId} AND l.entry_id IN (${sql.join(entries.map((e) => sql`${e.id}`), sql`, `)})
    ORDER BY l.line_order`);
  const byEntry = new Map<string, any[]>();
  for (const l of lines) {
    if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []);
    byEntry.get(l.entry_id)!.push({ side: l.side, amount: l.amount, account: `${l.code} ${l.name}` });
  }
  return { entries: entries.map((e) => ({ ...e, lines: byEntry.get(e.id) ?? [] })) };
}

export async function razao(tenantId: string, accountId: string, from: string, to: string, db: DrizzleDB = _db) {
  const [account] = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.id, accountId));
  if (!account) return { account: null, lines: [], saldoAnterior: 0, saldoFinal: 0 };

  const { rows: prior } = await db.execute<any>(sql`
    SELECT COALESCE(SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END), 0) AS net
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.tenant_id = ${tenantId} AND l.account_id = ${accountId} AND e.entry_date < ${from}`);
  const sign = account.normal_balance === 'debit' ? 1 : -1;
  const saldoAnterior = round2(Number(prior[0].net) * sign);

  const { rows } = await db.execute<any>(sql`
    SELECT e.entry_date, e.description, e.source_type, l.side, l.amount
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE l.tenant_id = ${tenantId} AND l.account_id = ${accountId}
      AND e.entry_date >= ${from} AND e.entry_date <= ${to}
    ORDER BY e.entry_date, e.created_at LIMIT 1000`);

  let saldo = saldoAnterior;
  const lines = rows.map((r: any) => {
    const delta = (r.side === 'debit' ? 1 : -1) * sign * toNumber(r.amount);
    saldo = round2(saldo + delta);
    return { date: r.entry_date, description: r.description, source: r.source_type, side: r.side, amount: toNumber(r.amount), saldo };
  });
  return { account: { id: account.id, code: account.code, name: account.name }, saldoAnterior, lines, saldoFinal: saldo };
}

/** Livro caixa: razão consolidado das contas caixa+bancos (regime caixa formal). */
export async function livroCaixa(tenantId: string, from: string, to: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<any>(sql`
    SELECT e.entry_date, e.description, e.source_type, l.side, l.amount, a.system_key
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN chart_of_accounts a ON a.id = l.account_id
    WHERE l.tenant_id = ${tenantId} AND a.system_key IN ('caixa','bancos')
      AND e.entry_date >= ${from} AND e.entry_date <= ${to}
    ORDER BY e.entry_date, e.created_at LIMIT 1000`);
  let saldo = 0;
  const lines = rows.map((r: any) => {
    const delta = (r.side === 'debit' ? 1 : -1) * toNumber(r.amount);
    saldo = round2(saldo + delta);
    return {
      date: r.entry_date, description: r.description, source: r.source_type,
      conta: r.system_key, entrada: r.side === 'debit' ? toNumber(r.amount) : 0,
      saida: r.side === 'credit' ? toNumber(r.amount) : 0, saldo,
    };
  });
  return { lines, saldoFinal: saldo };
}

/** DRE contábil: saldos das contas de resultado no período. */
export async function dreContabil(tenantId: string, from: string, to: string, db: DrizzleDB = _db) {
  const rows = (await accountBalances(tenantId, { from, to }, db))
    .filter((r) => r.nature === 'receita' || r.nature === 'despesa');
  const saldo = (r: AccountBalanceRow) => round2(r.normalBalance === 'debit' ? r.debit - r.credit : r.credit - r.debit);
  const receitas = rows.filter((r) => r.nature === 'receita').map((r) => ({ code: r.code, name: r.name, valor: saldo(r) }));
  const despesas = rows.filter((r) => r.nature === 'despesa').map((r) => ({ code: r.code, name: r.name, valor: saldo(r) }));
  const totalReceitas = round2(receitas.reduce((s, r) => s + r.valor, 0));
  const totalDespesas = round2(despesas.reduce((s, r) => s + r.valor, 0));
  return {
    label: 'DRE contábil (dupla entrada) — difere do DRE gerencial por construção',
    receitas, despesas, totalReceitas, totalDespesas,
    resultado: round2(totalReceitas - totalDespesas),
  };
}
