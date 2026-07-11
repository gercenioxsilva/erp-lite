import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { receivables } from '../db/schema';
import { isUniqueConstraintViolation } from '../lib/pgErrors';

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
