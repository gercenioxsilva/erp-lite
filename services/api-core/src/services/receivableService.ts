import crypto from 'crypto';
import { sql, eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { receivables } from '../db/schema';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { generateInstallmentSchedule, type PaymentPlanInstallmentInput } from '../domain/paymentPlan/paymentPlanDomain';

export type DrizzleDB = typeof _db;
export type Receivable = typeof receivables.$inferSelect;

export interface CreateReceivableFromInvoiceArgs {
  tenantId:    string;
  invoiceId:   string;
  clientId:    string | null;
  amount:      string;
  description: string;
  dueDate:     string; // YYYY-MM-DD
}

/**
 * Cria a conta a receber de uma nota fiscal emitida — é o fluxo correto de
 * qualquer ERP: toda nota de venda autorizada gera um recebível, a nota é o
 * fato gerador. Idempotente por `invoice_id` (UNIQUE parcial em
 * `receivables`, migration 0065) — mesmo padrão já usado por
 * `accrueCommission` (`commissionService.ts`, `idempotency_key`) e pela
 * regra 48 (`service_order_id`): tentar duas vezes para a mesma nota nunca
 * duplica, só devolve o recebível que já existia.
 *
 * Usado pelo `nfeResultsWorker.ts` (autorização real via SEFAZ) e por
 * `routes/invoices.ts` (`POST /invoices/:id/issue`, caminho legado) — os
 * dois pontos que podem "emitir" uma nota, pra nunca divergir a lógica de
 * criação do recebível entre eles.
 */
export async function createReceivableFromInvoice(
  args: CreateReceivableFromInvoiceArgs, db: DrizzleDB = _db,
): Promise<Receivable> {
  try {
    const [inserted] = await db.insert(receivables).values({
      tenant_id:   args.tenantId,
      client_id:   args.clientId,
      invoice_id:  args.invoiceId,
      description: args.description,
      amount:      args.amount,
      due_date:    args.dueDate,
      status:      'pending',
    }).returning();
    return inserted;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const [existing] = await db.select().from(receivables)
        .where(sql`invoice_id = ${args.invoiceId}`);
      return existing;
    }
    throw err;
  }
}

export interface CreateReceivablesFromInvoiceWithPlanArgs {
  tenantId:    string;
  invoiceId:   string;
  clientId:    string | null;
  amount:      number;   // total da nota (não string — o domínio faz a matemática)
  description: string;   // base, ex.: "NF-e nº 123 (série 1)" — cada parcela ganha "— Parcela N/T"
  baseDate:    string;   // YYYY-MM-DD — data de emissão, ponto de partida dos days_offset
  installments: PaymentPlanInstallmentInput[]; // parcelas do Plano de Pagamento (payment_plan_installments)
}

/**
 * Variante de `createReceivableFromInvoice()` pra quando a nota tem um Plano
 * de Pagamento (regra 75, migration 0086): gera N recebíveis (um por
 * parcela) em vez de um só, cada um com `installment_number` distinto —
 * idempotente por `(invoice_id, installment_number)` (UNIQUE parcial,
 * migration 0086), mesmo padrão de try/insert → catch 23505 → select já
 * existente usado em `createReceivableFromInvoice()` acima, só repetido por
 * parcela. `createReceivableFromInvoice()` continua intocada — chamadores
 * sem plano nunca passam por aqui.
 */
export async function createReceivablesFromInvoiceWithPlan(
  args: CreateReceivablesFromInvoiceWithPlanArgs, db: DrizzleDB = _db,
): Promise<Receivable[]> {
  const schedule = generateInstallmentSchedule(args.amount, args.baseDate, args.installments);
  const groupId = schedule.length > 1 ? crypto.randomUUID() : null;

  const results: Receivable[] = [];
  for (const item of schedule) {
    const description = schedule.length > 1
      ? `${args.description} — Parcela ${item.installment_number}/${item.installment_total}`
      : args.description;
    try {
      const [inserted] = await db.insert(receivables).values({
        tenant_id:   args.tenantId,
        client_id:   args.clientId,
        invoice_id:  args.invoiceId,
        description,
        amount:      item.amount,
        due_date:    item.due_date,
        status:      'pending',
        installment_number:   item.installment_number,
        installment_total:    item.installment_total,
        installment_group_id: groupId,
      }).returning();
      results.push(inserted);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const [existing] = await db.select().from(receivables).where(and(
          eq(receivables.invoice_id, args.invoiceId),
          eq(receivables.installment_number, item.installment_number),
        ));
        results.push(existing);
      } else {
        throw err;
      }
    }
  }
  return results;
}

// ── Registro de pagamento (extraído de routes/receivables.ts POST /:id/payments)
// Compartilhado pela rota e pelo motor de conciliação (0072) — a lógica de
// flip pending→partial/paid + insert em receivable_payments nunca diverge
// entre os dois caminhos. Comportamento preservado 1:1 (validações e valores).

import { receivablePayments } from '../db/schema';
import { notifyPaymentConfirmed } from './whatsappAutomationService';
import { postEntry, resolveRegime } from './accountingService';
import { linesForReceivablePayment } from '../domain/accounting/accountingDomain';

export const VALID_PAYMENT_METHODS = ['pix', 'bank_transfer', 'cash', 'credit_card', 'debit_card', 'boleto', 'check', 'other'] as const;

export class ReceivablePaymentError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ReceivablePaymentError';
  }
}

export interface RegisterReceivablePaymentArgs {
  tenantId:      string;
  receivableId:  string;
  paymentDate:   string;              // YYYY-MM-DD
  amount:        number | string;
  paymentMethod: string;
  reference?:    string | null;       // NSU/id bancário — trilha da conciliação
  notes?:        string | null;
  createdBy:     string | null;       // null = sistema (conciliação automática)
}

export interface RegisterReceivablePaymentResult {
  payment:       typeof receivablePayments.$inferSelect;
  newStatus:     'partial' | 'paid';
  newPaidAmount: number;
}

export async function registerReceivablePayment(
  args: RegisterReceivablePaymentArgs, db: DrizzleDB = _db,
): Promise<RegisterReceivablePaymentResult> {
  const payAmt = Number(args.amount);
  if (!args.paymentDate) throw new ReceivablePaymentError('payment_date_required');
  if (!payAmt || payAmt <= 0) throw new ReceivablePaymentError('invalid_amount');
  if (!VALID_PAYMENT_METHODS.includes(args.paymentMethod as any)) {
    throw new ReceivablePaymentError('invalid_method', { valid: [...VALID_PAYMENT_METHODS] });
  }

  const [rec] = await db.select({
    id: receivables.id, status: receivables.status,
    amount: receivables.amount, paid_amount: receivables.paid_amount,
    client_id: receivables.client_id, description: receivables.description,
    invoice_id: receivables.invoice_id, service_order_id: receivables.service_order_id,
  }).from(receivables)
    .where(and(eq(receivables.id, args.receivableId), eq(receivables.tenant_id, args.tenantId)));

  if (!rec) throw new ReceivablePaymentError('receivable_not_found');
  if (rec.status === 'cancelled') throw new ReceivablePaymentError('receivable_cancelled');

  const newPaidAmt = Math.round((Number(rec.paid_amount) + payAmt) * 100) / 100;
  const newStatus: 'partial' | 'paid' = newPaidAmt >= Number(rec.amount) ? 'paid' : 'partial';

  const payment = await db.transaction(async (tx) => {
    const [pay] = await tx.insert(receivablePayments).values({
      tenant_id: args.tenantId, receivable_id: args.receivableId,
      payment_date: args.paymentDate, amount: String(payAmt.toFixed(2)),
      payment_method: args.paymentMethod,
      reference: args.reference || null, notes: args.notes || null,
      created_by: args.createdBy,
    }).returning();
    await tx.update(receivables)
      .set({ paid_amount: String(newPaidAmt.toFixed(2)), status: newStatus })
      .where(eq(receivables.id, args.receivableId));
    return pay;
  });

  // WhatsApp: só na quitação total (mesmo comportamento da rota original);
  // fire-and-forget — nunca bloqueia nem falha o registro do pagamento.
  if (newStatus === 'paid') {
    void notifyPaymentConfirmed(args.tenantId, {
      id: rec.id, client_id: rec.client_id, description: rec.description, amount: rec.amount,
    });
  }

  // ── Posting contábil (fire-and-forget, idempotente por payment.id) ──────
  // hasPriorAuthorization ≈ recebível vinculado a documento fiscal (a
  // autorização posta no regime competência); sem doc → receita direta.
  void (async () => {
    try {
      const { regime, companyId } = await resolveRegime(args.tenantId, null, db);
      await postEntry({
        tenantId: args.tenantId, companyId,
        sourceType: 'receivable_payment', sourceId: payment.id,
        entryDate: args.paymentDate, competencia: args.paymentDate.slice(0, 7),
        description: `Recebimento — ${rec.description ?? 'conta a receber'}`,
        lines: linesForReceivablePayment({
          amount: payAmt,
          viaBank: args.paymentMethod !== 'cash',
          hasPriorAuthorization: !!rec.invoice_id,
          serviceRevenue: !rec.invoice_id, // sem NF-e assume serviço
        }, regime),
      }, db);
    } catch (err) {
      console.error(JSON.stringify({ event: 'accounting_post_error', source: 'receivable_payment', id: payment.id, error: String(err) }));
    }
  })();

  return { payment, newStatus, newPaidAmount: newPaidAmt };
}
