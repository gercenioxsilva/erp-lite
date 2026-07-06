// Application Service — NF-e de Entrada (P1)
// Ao confirmar uma NF-e de entrada:
//   1. Cria um Payable automaticamente (conta a pagar ao fornecedor)
//   2. Registra movimentação de entrada no inventário (para cada item com material_id)
// Segue o padrão de injeção de db para testabilidade isolada.

import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { supplierInvoices, supplierInvoiceItems, payables, inventory, inventoryMovements } from '../db/schema';
import {
  assertSITransition,
  validateSICreate,
  matchAgainstPO,
  splitInstallmentAmounts,
  addMonthsToDateStr,
  SupplierInvoiceDomainError,
  type SIStatus,
} from '../domain/supplierInvoice/supplierInvoiceDomain';

export type DrizzleDB = typeof _db;
export { SupplierInvoiceDomainError };

export type SICreate = {
  tenantId:         string;
  supplierId?:      string | null;
  supplierName?:    string | null;
  purchaseOrderId?: string | null;
  nfeKey?:          string | null;
  nfeNumber?:       string | null;
  nfeSeries?:       string;
  issueDate?:       string | null;
  dueDate?:         string | null;
  subtotal:         number;
  taxTotal?:        number;
  total:            number;
  installments?:    number;
  notes?:           string | null;
  costCenterId?:    string | null;
  createdBy?:       string | null;
  items: Array<{
    materialId?:  string | null;
    name:         string;
    ncmCode?:     string | null;
    cfop?:        string | null;
    unit?:        string;
    quantity:     number;
    unit_price:   number;
    icmsRate?:    number;
    icmsValue?:   number;
    ipiRate?:     number;
    ipiValue?:    number;
  }>;
};

export async function createSupplierInvoice(args: SICreate, db: DrizzleDB) {
  validateSICreate({
    items: args.items.map(it => ({ quantity: it.quantity, unit_price: it.unit_price })),
    total: args.total,
  });

  return db.transaction(async (tx) => {
    const [si] = await tx.insert(supplierInvoices).values({
      tenant_id:        args.tenantId,
      supplier_id:      args.supplierId   || null,
      supplier_name:    args.supplierName || null,
      purchase_order_id: args.purchaseOrderId || null,
      nfe_key:          args.nfeKey    || null,
      nfe_number:       args.nfeNumber || null,
      nfe_series:       args.nfeSeries || '1',
      issue_date:       args.issueDate || null,
      due_date:         args.dueDate   || null,
      subtotal:         String(args.subtotal),
      tax_total:        String(args.taxTotal ?? 0),
      total:            String(args.total),
      installments:     args.installments && args.installments > 1 ? args.installments : 1,
      status:           'draft',
      notes:            args.notes || null,
      cost_center_id:   args.costCenterId || null,
      created_by:       args.createdBy || null,
    }).returning();

    for (const it of args.items) {
      await tx.insert(supplierInvoiceItems).values({
        supplier_invoice_id: si.id,
        material_id:  it.materialId || null,
        name:         it.name,
        ncm_code:     it.ncmCode || null,
        cfop:         it.cfop    || null,
        unit:         it.unit    || 'UN',
        quantity:     String(it.quantity),
        unit_price:   String(it.unit_price),
        total:        String(Math.round(it.quantity * it.unit_price * 100) / 100),
        icms_rate:    it.icmsRate  != null ? String(it.icmsRate)  : null,
        icms_value:   it.icmsValue != null ? String(it.icmsValue) : null,
        ipi_rate:     it.ipiRate   != null ? String(it.ipiRate)   : null,
        ipi_value:    it.ipiValue  != null ? String(it.ipiValue)  : null,
      });
    }

    return si;
  });
}

export async function confirmSupplierInvoice(
  id:       string,
  tenantId: string,
  userId:   string | null,
  db:       DrizzleDB,
) {
  return db.transaction(async (tx) => {
    const { rows: [si] } = await tx.execute<{
      status: string; supplier_id: string | null; supplier_name: string | null;
      total: string; due_date: string | null; purchase_order_id: string | null; installments: number;
      payable_id: string | null; installment_group_id: string | null;
    }>(sql`SELECT status, supplier_id, supplier_name, total, due_date, purchase_order_id, installments,
                  payable_id, installment_group_id
           FROM supplier_invoices WHERE id = ${id} AND tenant_id = ${tenantId}`);
    if (!si) throw new SupplierInvoiceDomainError('si_not_found', { id });

    assertSITransition(si.status as SIStatus, 'confirmed');

    // Estoque só pode ser alimentado UMA única vez por nota (regra 47) — a
    // única forma de chamar confirm() duas vezes hoje é resolver uma
    // 'divergence' (que já rodou payable + estoque na 1ª tentativa) para
    // 'confirmed'. Nesse caso, só troca o status: nunca refaz payable nem
    // movimentação de estoque, pra nunca duplicar entrada.
    if (si.status === 'divergence') {
      await tx.execute(sql`
        UPDATE supplier_invoices SET status = 'confirmed', confirmed_by = ${userId}, confirmed_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
      if (si.purchase_order_id) {
        await tx.execute(sql`
          UPDATE purchase_orders SET status = 'received'
          WHERE id = ${si.purchase_order_id} AND tenant_id = ${tenantId} AND status = 'approved'
        `);
      }
      return { id, status: 'confirmed', payable_id: si.payable_id, installments_generated: si.installments || 1 };
    }

    const { rows: items } = await tx.execute<{
      material_id: string | null; name: string; quantity: string; unit_price: string;
    }>(sql`SELECT material_id, name, quantity, unit_price FROM supplier_invoice_items
           WHERE supplier_invoice_id = ${id}`);

    // 1. Cria o(s) Payable(s) automaticamente — parcelamento (regra 47):
    // installments <= 1 mantém o comportamento de sempre (um payable, sem
    // campos de parcela). installments > 1 gera N payables com vencimento
    // mensal automático a partir de due_date, valor dividido igualmente
    // (resto de centavos na última parcela).
    const baseDueDate = si.due_date ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const installmentCount = si.installments && si.installments > 1 ? si.installments : 1;
    const installmentGroupId = installmentCount > 1 ? crypto.randomUUID() : null;
    const amounts = splitInstallmentAmounts(Number(si.total), installmentCount);

    let firstPayableId: string | null = null;
    for (let i = 0; i < installmentCount; i++) {
      const [row] = await tx.insert(payables).values({
        tenant_id:     tenantId,
        supplier_id:   si.supplier_id   || null,
        supplier_name: si.supplier_name || null,
        category:      'supplies',
        description:   installmentCount > 1
          ? `NF-e Entrada ${id} — Parcela ${i + 1}/${installmentCount}`
          : `NF-e Entrada ${id}`,
        amount:        String(amounts[i]),
        paid_amount:   '0',
        due_date:      addMonthsToDateStr(baseDueDate, i),
        status:        'pending',
        created_by:    userId ?? null,
        installment_number:   installmentCount > 1 ? i + 1 : null,
        installment_total:    installmentCount > 1 ? installmentCount : null,
        installment_group_id: installmentGroupId,
      } as any).returning({ id: payables.id });
      if (i === 0) firstPayableId = row.id;
    }
    const payable = { id: firstPayableId! };

    // 2. Movimentação de entrada no inventário (para cada item com material_id)
    for (const it of items) {
      if (!it.material_id) continue;

      const { rows: [inv] } = await tx.execute<{ id: string; quantity: string }>(
        sql`SELECT id, quantity FROM inventory WHERE tenant_id = ${tenantId} AND material_id = ${it.material_id} FOR UPDATE`,
      );

      const qty = Number(it.quantity);
      if (inv) {
        const before = Number(inv.quantity);
        const after  = before + qty;
        await tx.execute(sql`UPDATE inventory SET quantity = ${String(after)} WHERE id = ${inv.id}`);
        await tx.insert(inventoryMovements).values({
          tenant_id:       tenantId,
          material_id:     it.material_id,
          movement_type:   'in',
          quantity:        String(qty),
          quantity_before: String(before),
          quantity_after:  String(after),
          reason:          'Recebimento NF-e Entrada',
          reference_id:    id,
          reference_type:  'supplier_invoice',
        } as any);
      }
    }

    // 3. Checa matching com PO se existir
    let matchStatus: SIStatus = 'confirmed';
    if (si.purchase_order_id) {
      const { rows: poItems } = await tx.execute<{
        material_id: string | null; quantity: string; unit_price: string;
      }>(sql`SELECT material_id, quantity, unit_price FROM purchase_order_items
             WHERE purchase_order_id = ${si.purchase_order_id}`);

      const match = matchAgainstPO(
        items.map(it => ({ material_id: it.material_id, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
        poItems.map(it => ({ material_id: it.material_id, quantity: Number(it.quantity), unit_price: Number(it.unit_price) })),
      );
      if (match === 'quantity_divergence' || match === 'price_divergence') {
        matchStatus = 'divergence';
      }
    }

    // 4. Atualiza status da NF-e de entrada
    await tx.execute(sql`
      UPDATE supplier_invoices
      SET status = ${matchStatus}, payable_id = ${payable.id}, installment_group_id = ${installmentGroupId},
          confirmed_by = ${userId}, confirmed_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);

    // 5. Marca o PO como received se existir e estiver aprovado
    if (si.purchase_order_id && matchStatus === 'confirmed') {
      await tx.execute(sql`
        UPDATE purchase_orders SET status = 'received'
        WHERE id = ${si.purchase_order_id} AND tenant_id = ${tenantId} AND status = 'approved'
      `);
    }

    return { id, status: matchStatus, payable_id: payable.id, installments_generated: installmentCount };
  });
}

export async function cancelSupplierInvoice(
  id:       string,
  tenantId: string,
  db:       DrizzleDB,
) {
  return db.transaction(async (tx) => {
    const { rows: [si] } = await tx.execute<{
      status: string; payable_id: string | null; installment_group_id: string | null;
    }>(sql`SELECT status, payable_id, installment_group_id FROM supplier_invoices WHERE id = ${id} AND tenant_id = ${tenantId}`);
    if (!si) throw new SupplierInvoiceDomainError('si_not_found', { id });

    assertSITransition(si.status as SIStatus, 'cancelled');

    // Cancelar uma nota já confirmada (regra 47) precisa cancelar junto o(s)
    // payable(s) gerados — parcelados (installment_group_id) ou não
    // (payable_id) — nunca deleta, só marca 'cancelled' (mesmo princípio de
    // commission_entries, regra 8). Se qualquer parcela já foi paga, bloqueia
    // (mesma regra de routes/payables.ts: não é possível cancelar conta paga).
    if (si.payable_id) {
      const { rows: linked } = await tx.execute<{ id: string; status: string; paid_amount: string }>(
        si.installment_group_id
          ? sql`SELECT id, status, paid_amount FROM payables WHERE tenant_id = ${tenantId} AND installment_group_id = ${si.installment_group_id}`
          : sql`SELECT id, status, paid_amount FROM payables WHERE tenant_id = ${tenantId} AND id = ${si.payable_id}`,
      );

      const hasPaid = linked.some(p => p.status === 'paid' || Number(p.paid_amount) > 0);
      if (hasPaid) throw new SupplierInvoiceDomainError('si_has_paid_installments', { id });

      for (const p of linked) {
        if (p.status !== 'cancelled') {
          await tx.execute(sql`UPDATE payables SET status = 'cancelled' WHERE id = ${p.id}`);
        }
      }
    }

    await tx.execute(sql`
      UPDATE supplier_invoices SET status = 'cancelled' WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
  });
}
