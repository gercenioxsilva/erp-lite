// Registro de pagamento de conta a pagar — extraído de routes/payables.ts
// (POST /payables/:id/payments) para ser reusado pela conciliação de débitos
// (Tesouraria 0082): mesmo insert + atualização de paid_amount/status + posting
// contábil D-despesa/C-Bancos (fire-and-forget, idempotente por payment.id).

import { and, eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { payables, payablePayments, dreCategories } from '../db/schema';
import { postEntry, resolveRegime } from './accountingService';
import { linesForPayablePayment, DRE_TO_ACCOUNT } from '../domain/accounting/accountingDomain';

export type DrizzleDB = typeof _db;

export const VALID_PAYABLE_METHODS = ['pix', 'bank_transfer', 'cash', 'credit_card', 'debit_card', 'boleto', 'check', 'other'] as const;
export type PayableMethod = typeof VALID_PAYABLE_METHODS[number];

export class PayablePaymentError extends Error {
  constructor(public code: 'payable_not_found' | 'payable_cancelled') {
    super(code); this.name = 'PayablePaymentError';
  }
}

// Conta de despesa quando não há dre_category_id vinculada (categoria simples).
const CATEGORY_TO_ACCOUNT: Record<string, string> = {
  rent: 'despesa_aluguel', utilities: 'despesa_utilidades', payroll: 'despesa_pessoal',
  supplies: 'cmv', services: 'despesa_admin', taxes: 'despesa_tributaria', other: 'despesa_outras',
};

/** dre_category_id → dre_categories.code → conta; senão a categoria simples;
 *  fallback despesa_outras. */
export async function resolvePayableExpenseKey(
  dreCategoryId: string | null, category: string | null, db: DrizzleDB = _db,
): Promise<string> {
  if (dreCategoryId) {
    const [dc] = await db.select({ code: dreCategories.code }).from(dreCategories)
      .where(eq(dreCategories.id, dreCategoryId));
    if (dc?.code && DRE_TO_ACCOUNT[dc.code]) return DRE_TO_ACCOUNT[dc.code];
  }
  return (category && CATEGORY_TO_ACCOUNT[category]) || 'despesa_outras';
}

export interface RegisterPayablePaymentArgs {
  tenantId: string;
  payableId: string;
  paymentDate: string;          // 'YYYY-MM-DD'
  amount: number;
  paymentMethod: PayableMethod;
  reference?: string | null;
  notes?: string | null;
  createdBy: string | null;
}

export async function registerPayablePayment(args: RegisterPayablePaymentArgs, db: DrizzleDB = _db) {
  const [pay] = await db.select({
    id: payables.id, status: payables.status,
    amount: payables.amount, paid_amount: payables.paid_amount,
    category: payables.category, dre_category_id: payables.dre_category_id,
    description: payables.description,
  }).from(payables).where(and(eq(payables.id, args.payableId), eq(payables.tenant_id, args.tenantId)));

  if (!pay) throw new PayablePaymentError('payable_not_found');
  if (pay.status === 'cancelled') throw new PayablePaymentError('payable_cancelled');

  const payAmt     = Number(args.amount);
  const newPaidAmt = Math.round((Number(pay.paid_amount) + payAmt) * 100) / 100;
  const newStatus  = newPaidAmt >= Number(pay.amount) ? 'paid' : 'partial';

  const payment = await db.transaction(async (tx) => {
    const [p] = await tx.insert(payablePayments).values({
      tenant_id: args.tenantId, payable_id: args.payableId,
      payment_date: args.paymentDate, amount: String(payAmt.toFixed(2)),
      payment_method: args.paymentMethod, reference: args.reference || null, notes: args.notes || null,
      created_by: args.createdBy,
    }).returning();

    await tx.update(payables).set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
      .where(eq(payables.id, args.payableId));

    return p;
  });

  // Posting contábil (fire-and-forget, idempotente por payment.id):
  // D-conta de despesa / C-Bancos.
  void (async () => {
    try {
      const expenseKey = await resolvePayableExpenseKey(pay.dre_category_id, pay.category, db);
      const { companyId } = await resolveRegime(args.tenantId, null, db);
      await postEntry({
        tenantId: args.tenantId, companyId,
        sourceType: 'payable_payment', sourceId: payment.id,
        entryDate: args.paymentDate, competencia: String(args.paymentDate).slice(0, 7),
        description: `Pagamento — ${pay.description}`,
        lines: linesForPayablePayment({ amount: payAmt, expenseKey }),
      }, db);
    } catch (err) {
      console.error(JSON.stringify({ event: 'accounting_post_error', source: 'payable_payment', id: payment.id, error: String(err) }));
    }
  })();

  return { payment, newStatus, newPaidAmount: newPaidAmt };
}
