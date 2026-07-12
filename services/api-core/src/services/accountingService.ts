// Motor contábil (0078) — camada de serviço.
// postFromSource: idempotente por UNIQUE(source_type,source_id) + catch-23505;
// respeita a trava de competência (assertCompetenciaAberta) e o regime da
// empresa (fiscal_company_config.regime_apuracao; fato tenant-level usa a
// empresa default). Chamado FIRE-AND-FORGET nos seams (nunca lança lá).
// reverseEntry: estorno com linhas invertidas — razão é append-only.

import { eq, and, inArray, isNull, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { chartOfAccounts, journalEntries, journalLines } from '../db/schema';
import { resolveCompanyId } from './companyService';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { assertCompetenciaAberta } from './fiscalPeriodLockGuard';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toDecimalString } from '../lib/money';
import {
  EntryDraft, LineSpec, Regime, validateEntry, AccountingDomainError,
} from '../domain/accounting/accountingDomain';

export type DrizzleDB = typeof _db;
export type JournalEntry = typeof journalEntries.$inferSelect;

/** Conta efetiva por system_key: custom do tenant sobrepõe a global. */
export async function resolveAccountByKey(tenantId: string, systemKey: string, db: DrizzleDB = _db): Promise<string> {
  const rows = await db.select({ id: chartOfAccounts.id, tenant_id: chartOfAccounts.tenant_id })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.system_key, systemKey), eq(chartOfAccounts.is_active, true),
      sql`(${chartOfAccounts.tenant_id} = ${tenantId} OR ${chartOfAccounts.tenant_id} IS NULL)`));
  const custom = rows.find((r) => r.tenant_id === tenantId);
  const account = custom ?? rows[0];
  if (!account) throw new AccountingDomainError('account_key_not_found', { systemKey });
  return account.id;
}

export interface PostArgs {
  tenantId: string;
  companyId?: string | null;   // NULL = fato tenant-level (regime da empresa default)
  sourceType: string;
  sourceId: string | null;
  entryDate: string;           // YYYY-MM-DD
  competencia: string;         // YYYY-MM (DAS: competência da APURAÇÃO)
  description: string;
  lines: LineSpec[];
  postedBy?: string | null;
}

export async function postEntry(args: PostArgs, db: DrizzleDB = _db): Promise<{ posted: boolean; duplicate: boolean; entryId: string | null }> {
  const draft: EntryDraft = {
    entryDate: args.entryDate, competencia: args.competencia,
    description: args.description, lines: args.lines.filter((l) => l.amount > 0),
  };
  if (draft.lines.length === 0) return { posted: false, duplicate: false, entryId: null }; // regra no-op (ex.: caixa na autorização)
  validateEntry(draft);
  await assertCompetenciaAberta(args.tenantId, args.companyId ?? null, args.competencia, db);

  // Resolve contas fora da transação (leituras).
  const accountIds = new Map<string, string>();
  for (const l of draft.lines) {
    if (!accountIds.has(l.accountKey)) accountIds.set(l.accountKey, await resolveAccountByKey(args.tenantId, l.accountKey, db));
  }

  try {
    const entryId = await db.transaction(async (tx) => {
      const [entry] = await tx.insert(journalEntries).values({
        tenant_id: args.tenantId, company_id: args.companyId ?? null,
        entry_date: args.entryDate, competencia: args.competencia,
        source_type: args.sourceType, source_id: args.sourceId,
        description: args.description.slice(0, 200), posted_by: args.postedBy ?? null,
      }).returning({ id: journalEntries.id });
      await tx.insert(journalLines).values(draft.lines.map((l, i) => ({
        tenant_id: args.tenantId, entry_id: entry.id,
        account_id: accountIds.get(l.accountKey)!,
        side: l.side, amount: toDecimalString(l.amount), line_order: i,
      })));
      return entry.id;
    });
    return { posted: true, duplicate: false, entryId };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { posted: false, duplicate: true, entryId: null };
    throw err;
  }
}

/** Regime efetivo: da empresa do fato, ou da empresa default p/ fato tenant-level. */
export async function resolveRegime(tenantId: string, companyId: string | null, db: DrizzleDB = _db): Promise<{ regime: Regime; companyId: string | null }> {
  try {
    const company = companyId
      ? { id: companyId }
      : await resolveCompanyId(tenantId, null, db);
    const config = await getOrCreateConfig(tenantId, company.id, db);
    return { regime: config.regime_apuracao as Regime, companyId: company.id };
  } catch {
    return { regime: 'competencia', companyId }; // tenant sem empresa: default seguro
  }
}

/** Estorno: entry 'reversal' com linhas invertidas (nunca delete). */
export async function reverseEntry(
  tenantId: string, args: { sourceType: string; sourceId: string; reason: string },
  actorUserId: string | null, db: DrizzleDB = _db,
): Promise<{ reversed: boolean }> {
  const [original] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.tenant_id, tenantId),
      eq(journalEntries.source_type, args.sourceType), eq(journalEntries.source_id, args.sourceId),
      isNull(journalEntries.reversed_by_entry_id)));
  if (!original) return { reversed: false }; // fato nunca postado (ex.: módulo desligado à época)

  const lines = await db.select().from(journalLines).where(eq(journalLines.entry_id, original.id));
  const inverted: LineSpec[] = lines.map((l) => ({
    accountKey: '', side: l.side === 'debit' ? 'credit' as const : 'debit' as const, amount: Number(l.amount),
  }));

  const reversalId = await db.transaction(async (tx) => {
    const [rev] = await tx.insert(journalEntries).values({
      tenant_id: tenantId, company_id: original.company_id,
      entry_date: new Date().toISOString().slice(0, 10), competencia: original.competencia,
      source_type: 'reversal', source_id: args.sourceId,
      description: `Estorno: ${args.reason}`.slice(0, 200), posted_by: actorUserId,
    }).returning({ id: journalEntries.id });
    await tx.insert(journalLines).values(lines.map((l, i) => ({
      tenant_id: tenantId, entry_id: rev.id, account_id: l.account_id,
      side: inverted[i].side, amount: l.amount, line_order: i,
    })));
    await tx.update(journalEntries).set({ reversed_by_entry_id: rev.id })
      .where(eq(journalEntries.id, original.id));
    return rev.id;
  });
  return { reversed: !!reversalId };
}

/** Lançamento manual (contabil:post) e saldo de abertura. */
export async function postManualEntry(
  tenantId: string, args: { companyId?: string | null; entryDate: string; competencia: string; description: string; lines: LineSpec[]; opening?: boolean },
  actorUserId: string, db: DrizzleDB = _db,
) {
  const result = await postEntry({
    tenantId, companyId: args.companyId ?? null,
    sourceType: args.opening ? 'opening_balance' : 'manual', sourceId: null,
    entryDate: args.entryDate, competencia: args.competencia,
    description: args.description, lines: args.lines, postedBy: actorUserId,
  }, db);
  if (!result.posted) throw new AccountingDomainError('entry_not_posted');
  return result;
}
