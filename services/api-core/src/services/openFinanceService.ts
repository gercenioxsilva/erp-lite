// Conciliação automática — conexões Open Finance (Pluggy). O sync traduz o
// extrato em imported_transactions (mesmo ledger do upload manual, dedup
// físico por UNIQUE) e entrega para o motor de conciliação de 0072. Cada
// sync vira um import_batch: os contadores inserted/duplicate e a fila de
// pendências existentes contam a história sem telemetria nova.

import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  bankConnections, bankConnectionAccounts, importBatches, importedTransactions,
} from '../db/schema';
import { resolveCompanyId } from './companyService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { runReconciliation } from './reconciliationService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toDecimalString } from '../lib/money';
import * as pluggy from '../lib/pluggyClient';
import {
  normalizePluggyTransaction, syncWindowStart,
} from '../domain/import/openFinanceDomain';

export type DrizzleDB = typeof _db;

export class OpenFinanceError extends Error {
  constructor(
    public code: 'openfinance_disabled' | 'connection_not_found' | 'item_id_required' | 'connection_already_exists',
    public payload: Record<string, unknown> = {},
  ) { super(code); this.name = 'OpenFinanceError'; }
}

function assertEnabled(): void {
  if (!pluggy.isOpenFinanceEnabled()) throw new OpenFinanceError('openfinance_disabled');
}

/** Token pro widget Pluggy Connect; `simulated` liga o fluxo local- na UI. */
export async function connectToken(): Promise<{ token: string; simulated: boolean }> {
  assertEnabled();
  return { token: await pluggy.createConnectToken(), simulated: pluggy.isSimulated() };
}

export async function registerConnection(
  tenantId: string, companyId: string | null | undefined, itemId: string,
  actorUserId: string | null, db: DrizzleDB = _db,
) {
  assertEnabled();
  if (!itemId?.trim()) throw new OpenFinanceError('item_id_required');
  const company = await resolveCompanyId(tenantId, companyId, db);

  const item = await pluggy.getItem(itemId.trim());
  const accounts = await pluggy.getAccounts(item.id);

  let conn;
  try {
    [conn] = await db.insert(bankConnections).values({
      tenant_id: tenantId, company_id: company.id,
      item_id: item.id, institution: item.connector?.name ?? null,
      created_by: actorUserId,
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new OpenFinanceError('connection_already_exists', { itemId: item.id });
    throw err;
  }

  for (const acc of accounts) {
    await db.insert(bankConnectionAccounts).values({
      tenant_id: tenantId, connection_id: conn.id, account_id: acc.id,
      type: acc.type ?? null, subtype: acc.subtype ?? null,
      name: acc.name ?? null, number_masked: acc.number ?? null,
      currency: acc.currencyCode ?? 'BRL',
      // Cartão de crédito fica fora por default: fatura não é recebimento —
      // conciliar contra receivables geraria só ruído na fila.
      sync_enabled: acc.type !== 'CREDIT',
    });
  }

  void recordFiscalEvent({
    tenantId, companyId: company.id, aggregateType: 'bank_connection', aggregateId: conn.id,
    eventType: 'openfinance_connected', actorUserId,
    requestPayload: { institution: conn.institution, accounts: accounts.length },
    idempotencyKey: `of_connected:${conn.id}`,
  }, db).catch(() => { /* auditoria fire-and-forget */ });

  return { ...conn, accounts };
}

export async function listConnections(tenantId: string, db: DrizzleDB = _db) {
  const conns = await db.select().from(bankConnections)
    .where(eq(bankConnections.tenant_id, tenantId))
    .orderBy(desc(bankConnections.created_at));
  const result = [];
  for (const c of conns) {
    const accounts = await db.select().from(bankConnectionAccounts)
      .where(eq(bankConnectionAccounts.connection_id, c.id));
    result.push({ ...c, accounts });
  }
  return result;
}

export async function disconnect(tenantId: string, connectionId: string, db: DrizzleDB = _db) {
  const [row] = await db.update(bankConnections)
    .set({ status: 'disconnected' })
    .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.tenant_id, tenantId)))
    .returning({ id: bankConnections.id });
  if (!row) throw new OpenFinanceError('connection_not_found');
  return { id: row.id, status: 'disconnected' as const };
}

export interface SyncResult {
  connectionId: string;
  inserted: number;
  duplicate: number;
  skippedPending: number;
  reconciliation: { processed: number; autoConfirmed: number } | null;
}

/**
 * Sincroniza UMA conexão: janela [last_synced_at − 3d | 90d] → hoje, por
 * conta habilitada; insere no ledger (dedup físico); roda a conciliação da
 * empresa. Erro marca a conexão como 'error' e NUNCA propaga pro ciclo.
 */
export async function syncConnection(
  tenantId: string, connectionId: string, db: DrizzleDB = _db,
): Promise<SyncResult> {
  assertEnabled();
  const [conn] = await db.select().from(bankConnections)
    .where(and(eq(bankConnections.id, connectionId), eq(bankConnections.tenant_id, tenantId)));
  if (!conn || conn.status === 'disconnected') throw new OpenFinanceError('connection_not_found');

  const accounts = await db.select().from(bankConnectionAccounts)
    .where(and(eq(bankConnectionAccounts.connection_id, conn.id), eq(bankConnectionAccounts.sync_enabled, true)));

  const now = new Date();
  const from = syncWindowStart(conn.last_synced_at, now);
  const fromISO = from.toISOString().slice(0, 10);
  const toISO = now.toISOString().slice(0, 10);

  // Cada sync é um batch próprio (contadores + fila de conciliação existentes).
  const syncLabel = `openfinance-sync ${conn.institution ?? conn.item_id} ${toISO}`;
  const [batch] = await db.insert(importBatches).values({
    tenant_id: tenantId, company_id: conn.company_id, source_kind: 'openfinance',
    original_filename: syncLabel,
    checksum_sha256: createHash('sha256').update(`${conn.id}:${now.toISOString()}`).digest('hex'),
    byte_size: 0, status: 'parsing',
  }).returning();

  let inserted = 0, duplicate = 0, skippedPending = 0, total = 0;
  try {
    for (const acc of accounts) {
      const txs = await pluggy.getTransactions(acc.account_id, fromISO, toISO);
      for (const tx of txs) {
        total++;
        if (tx.status === 'PENDING') { skippedPending++; continue; }
        const n = normalizePluggyTransaction(tx);
        try {
          await db.insert(importedTransactions).values({
            tenant_id: tenantId, company_id: conn.company_id, batch_id: batch.id,
            source: n.source, source_kind: n.source_kind, dedup_key: n.dedup_key,
            occurred_at: n.occurred_at, bank_account_ref: n.bank_account_ref,
            memo: n.memo, trn_type: n.trn_type,
            amount: toDecimalString(n.amount),
            payment_method: n.payment_method,
            customer_name: n.customer_name, customer_document: n.customer_document,
            raw: n.raw,
          });
          inserted++;
        } catch (err) {
          if (isUniqueConstraintViolation(err)) { duplicate++; continue; }
          throw err;
        }
      }
    }

    await db.update(importBatches).set({
      status: 'parsed', total_rows: total, inserted_rows: inserted,
      duplicate_rows: duplicate, processed_at: new Date(),
    }).where(eq(importBatches.id, batch.id));

    await db.update(bankConnections).set({
      status: 'active', last_synced_at: now, last_error: null,
    }).where(eq(bankConnections.id, conn.id));
  } catch (err) {
    await db.update(importBatches).set({ status: 'failed', error_message: String(err) })
      .where(eq(importBatches.id, batch.id));
    await db.update(bankConnections).set({ status: 'error', last_error: String(err) })
      .where(eq(bankConnections.id, conn.id));
    throw err;
  }

  // Conciliação da empresa — o motivo de tudo isso existir.
  let reconciliation: SyncResult['reconciliation'] = null;
  if (inserted > 0) {
    const r = await runReconciliation(tenantId, { companyId: conn.company_id }, db);
    reconciliation = { processed: r.processed, autoConfirmed: r.autoConfirmed };
  }

  void recordFiscalEvent({
    tenantId, companyId: conn.company_id, aggregateType: 'bank_connection', aggregateId: conn.id,
    eventType: 'openfinance_synced', actorUserId: null,
    requestPayload: { inserted, duplicate, skippedPending, from: fromISO, to: toISO },
    idempotencyKey: `of_sync:${batch.id}`,
  }, db).catch(() => { /* fire-and-forget */ });

  return { connectionId: conn.id, inserted, duplicate, skippedPending, reconciliation };
}

/** Passo 0 do ciclo 23:59: sincroniza toda conexão ativa, erro isolado. */
export async function syncAllActive(db: DrizzleDB = _db): Promise<{ synced: number; failed: number }> {
  if (!pluggy.isOpenFinanceEnabled()) return { synced: 0, failed: 0 };
  const conns = await db.select({ id: bankConnections.id, tenant_id: bankConnections.tenant_id })
    .from(bankConnections).where(eq(bankConnections.status, 'active'));
  let synced = 0, failed = 0;
  for (const c of conns) {
    try {
      await syncConnection(c.tenant_id, c.id, db);
      synced++;
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ event: 'openfinance_sync_error', connection_id: c.id, error: String(err) }));
    }
  }
  return { synced, failed };
}
