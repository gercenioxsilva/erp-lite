import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { commissionEntries } from '../db/schema';

// ── types ─────────────────────────────────────────────────────────────────────

export type DrizzleDB = typeof _db;

export type AccrueArgs = {
  tenantId:   string;
  sellerId:   string;
  invoiceId:  string;
  orderId?:   string | null;
  baseAmount: number;   // subtotal ou total da NF-e, conforme seller.commission_base
  rate:       number;   // percentual, ex.: 5 = 5%
};

export type CancelArgs = {
  tenantId:  string;
  invoiceId: string;
};

export type CommissionEntry = typeof commissionEntries.$inferSelect;

// ── helpers ───────────────────────────────────────────────────────────────────

function isUniqueConstraintViolation(err: unknown): boolean {
  if (err instanceof Error) {
    const pgErr = err as Error & { code?: string };
    if (pgErr.code === '23505') return true;
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.message.includes('23505')) {
      return true;
    }
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── accrueCommission ─────────────────────────────────────────────────────────
// Lança a comissão de uma NF-e autorizada. Idempotente por invoice_id — uma NF-e
// só pode gerar uma comissão (um vendedor por nota). Chamado pelo nfeResultsWorker
// no momento em que o status da NF-e vira 'authorized'.

export async function accrueCommission(args: AccrueArgs, db: DrizzleDB): Promise<CommissionEntry> {
  const idempotencyKey = `invoice:${args.invoiceId}`;
  const commissionAmount = round2((args.baseAmount * args.rate) / 100);

  try {
    const [inserted] = await db.insert(commissionEntries).values({
      tenant_id:         args.tenantId,
      seller_id:         args.sellerId,
      invoice_id:        args.invoiceId,
      order_id:          args.orderId ?? null,
      base_amount:       args.baseAmount.toFixed(2),
      rate:               args.rate.toFixed(2),
      commission_amount: commissionAmount.toFixed(2),
      status:             'accrued',
      idempotency_key:    idempotencyKey,
    }).returning();
    return inserted;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const existing = await db
        .select()
        .from(commissionEntries)
        .where(sql`tenant_id = ${args.tenantId} AND idempotency_key = ${idempotencyKey}`);
      return existing[0];
    }
    throw err;
  }
}

// ── cancelCommission ─────────────────────────────────────────────────────────
// Cancela a comissão de uma NF-e cancelada (status flag, nunca deleta — regra 8).
// Idempotente: se não houver comissão lançada (nota sem vendedor) ou já cancelada,
// retorna null sem efeito colateral.

export async function cancelCommission(args: CancelArgs, db: DrizzleDB): Promise<CommissionEntry | null> {
  const idempotencyKey = `invoice:${args.invoiceId}`;

  const [updated] = await db
    .update(commissionEntries)
    .set({ status: 'cancelled', cancelled_at: sql`now()` })
    .where(sql`
      tenant_id = ${args.tenantId}
      AND idempotency_key = ${idempotencyKey}
      AND status = 'accrued'
    `)
    .returning();

  return updated ?? null;
}
