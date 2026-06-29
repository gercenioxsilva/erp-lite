import { sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import {
  posSales,
  posSaleItems,
  posSalePayments,
  posCashMovements,
  invoices,
  materials,
} from '../../db/schema';
import { applyExit, applyEntry } from '../costCenterStock';

// ── helpers ───────────────────────────────────────────────────────────────────

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/**
 * Recomputes pos_sales.subtotal, discount_amount and total from its items.
 * Must be called within the same db instance (or tx) that owns the sale.
 */
async function recalculateSaleTotals(
  saleId: string,
  db: typeof _db
): Promise<void> {
  await db.execute(
    sql`UPDATE pos_sales SET
          subtotal        = COALESCE((SELECT SUM(unit_price * quantity) FROM pos_sale_items WHERE sale_id = ${saleId}), 0),
          discount_amount = COALESCE((SELECT SUM(discount_amount)       FROM pos_sale_items WHERE sale_id = ${saleId}), 0),
          total           = COALESCE((SELECT SUM(total)                 FROM pos_sale_items WHERE sale_id = ${saleId}), 0),
          updated_at      = NOW()
        WHERE id = ${saleId}`
  );
}

// ── createSale ────────────────────────────────────────────────────────────────

export async function createSale(params: {
  tenantId: string;
  sessionId: string;
  operatorId: string;
}): Promise<{ id: string }> {
  const { tenantId, sessionId, operatorId } = params;

  // Validate session is open and belongs to tenant
  const sessionRows = await _db.execute<{
    id: string;
    terminal_id: string;
  }>(
    sql`SELECT s.id, s.terminal_id
        FROM pos_sessions s
        WHERE s.id        = ${sessionId}
          AND s.tenant_id = ${tenantId}
          AND s.status    = 'open'
        LIMIT 1`
  );

  if (!sessionRows.rows.length) {
    throw httpError(404, 'Open session not found');
  }

  const session = sessionRows.rows[0];

  // Fetch terminal to get cost_center_id
  const terminalRows = await _db.execute<{
    id: string;
    cost_center_id: string | null;
  }>(
    sql`SELECT id, cost_center_id
        FROM pos_terminals
        WHERE id = ${session.terminal_id}
        LIMIT 1`
  );

  const terminal = terminalRows.rows.length ? terminalRows.rows[0] : null;

  const [sale] = await _db
    .insert(posSales)
    .values({
      tenant_id:      tenantId,
      session_id:     sessionId,
      terminal_id:    session.terminal_id,
      operator_id:    operatorId,
      cost_center_id: terminal?.cost_center_id ?? null,
      status:         'open',
    })
    .returning({ id: posSales.id });

  return { id: sale.id };
}

// ── addItem ───────────────────────────────────────────────────────────────────

export async function addItem(params: {
  tenantId: string;
  saleId: string;
  productId: string;
  quantity: number;
  discountAmount?: number;
}): Promise<{ id: string }> {
  const { tenantId, saleId, productId, quantity, discountAmount = 0 } = params;

  // Validate sale is open and belongs to tenant
  const saleRows = await _db.execute(
    sql`SELECT id FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  // Fetch material
  const matRows = await _db.execute<{
    id: string;
    name: string;
    sale_price: string;
    ncm_code: string | null;
    cfop: string | null;
    cst_csosn: string | null;
    unit: string;
    is_active: boolean;
  }>(
    sql`SELECT id, name, sale_price, ncm_code, cfop, cst_csosn, unit, is_active
        FROM materials
        WHERE id        = ${productId}
          AND tenant_id = ${tenantId}
        LIMIT 1`
  );

  if (!matRows.rows.length || !matRows.rows[0].is_active) {
    throw httpError(404, 'Product not found or inactive');
  }

  const mat = matRows.rows[0];
  const unitPrice = parseFloat(mat.sale_price);
  const itemTotal = Math.max(0, unitPrice * quantity - discountAmount);

  const [item] = await _db
    .insert(posSaleItems)
    .values({
      sale_id:         saleId,
      product_id:      productId,
      description:     mat.name,
      quantity:        quantity.toFixed(4),
      unit_price:      unitPrice.toFixed(2),
      discount_amount: discountAmount.toFixed(2),
      total:           itemTotal.toFixed(2),
      ncm:             mat.ncm_code ?? null,
      cfop:            mat.cfop ?? null,
      cst_csosn:       mat.cst_csosn ?? null,
      unit:            mat.unit,
    })
    .returning({ id: posSaleItems.id });

  await recalculateSaleTotals(saleId, _db);

  return { id: item.id };
}

// ── updateItem ────────────────────────────────────────────────────────────────

export async function updateItem(params: {
  tenantId: string;
  saleId: string;
  itemId: string;
  quantity?: number;
  discountAmount?: number;
}): Promise<void> {
  const { tenantId, saleId, itemId, quantity, discountAmount } = params;

  // Validate sale is open and belongs to tenant
  const saleRows = await _db.execute(
    sql`SELECT id FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  // Fetch current item
  const itemRows = await _db.execute<{
    id: string;
    unit_price: string;
    quantity: string;
    discount_amount: string;
  }>(
    sql`SELECT id, unit_price, quantity, discount_amount
        FROM pos_sale_items
        WHERE id      = ${itemId}
          AND sale_id = ${saleId}
        LIMIT 1`
  );

  if (!itemRows.rows.length) {
    throw httpError(404, 'Item not found');
  }

  const current = itemRows.rows[0];
  const newQuantity = quantity ?? parseFloat(current.quantity);
  const newDiscount = discountAmount ?? parseFloat(current.discount_amount);
  const unitPrice   = parseFloat(current.unit_price);
  const newTotal    = Math.max(0, unitPrice * newQuantity - newDiscount);

  await _db.execute(
    sql`UPDATE pos_sale_items SET
          quantity        = ${newQuantity.toFixed(4)},
          discount_amount = ${newDiscount.toFixed(2)},
          total           = ${newTotal.toFixed(2)}
        WHERE id = ${itemId}`
  );

  await recalculateSaleTotals(saleId, _db);
}

// ── removeItem ────────────────────────────────────────────────────────────────

export async function removeItem(params: {
  tenantId: string;
  saleId: string;
  itemId: string;
}): Promise<void> {
  const { tenantId, saleId, itemId } = params;

  // Validate sale is open
  const saleRows = await _db.execute(
    sql`SELECT id FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  await _db.execute(
    sql`DELETE FROM pos_sale_items WHERE id = ${itemId} AND sale_id = ${saleId}`
  );

  await recalculateSaleTotals(saleId, _db);
}

// ── setCustomer ───────────────────────────────────────────────────────────────

export async function setCustomer(params: {
  tenantId: string;
  saleId: string;
  doc?: string;
  name?: string;
}): Promise<void> {
  const { tenantId, saleId, doc, name } = params;

  const saleRows = await _db.execute(
    sql`SELECT id FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  await _db.execute(
    sql`UPDATE pos_sales SET
          customer_doc  = ${doc ?? null},
          customer_name = ${name ?? null},
          updated_at    = NOW()
        WHERE id = ${saleId}`
  );
}

// ── addPayment ────────────────────────────────────────────────────────────────

export async function addPayment(params: {
  tenantId: string;
  saleId: string;
  method: 'cash' | 'debit' | 'credit' | 'pix' | 'voucher' | 'store_credit';
  amount: number;
  installments?: number;
  authorizationCode?: string;
}): Promise<{ id: string; changeAmount: number }> {
  const { tenantId, saleId, method, amount, installments = 1, authorizationCode } = params;

  // Validate sale is open
  const saleRows = await _db.execute<{ id: string; total: string }>(
    sql`SELECT id, total FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  const saleTotal = parseFloat(saleRows.rows[0].total);

  // Fetch already paid amount
  const paidResult = await _db.execute<{ paid: string }>(
    sql`SELECT COALESCE(SUM(amount), 0)::text AS paid
        FROM pos_sale_payments
        WHERE sale_id = ${saleId}`
  );

  const alreadyPaid = parseFloat(paidResult.rows[0]?.paid ?? '0');

  // Compute change only for cash payments
  const remaining    = Math.max(0, saleTotal - alreadyPaid);
  const changeAmount = method === 'cash' ? Math.max(0, amount - remaining) : 0;

  const [payment] = await _db
    .insert(posSalePayments)
    .values({
      sale_id:            saleId,
      method,
      amount:             amount.toFixed(2),
      installments,
      authorization_code: authorizationCode ?? null,
      change_amount:      changeAmount.toFixed(2),
    })
    .returning({ id: posSalePayments.id });

  return { id: payment.id, changeAmount };
}

// ── removePayment ─────────────────────────────────────────────────────────────

export async function removePayment(params: {
  tenantId: string;
  saleId: string;
  paymentId: string;
}): Promise<void> {
  const { tenantId, saleId, paymentId } = params;

  // Validate sale is open
  const saleRows = await _db.execute(
    sql`SELECT id FROM pos_sales
        WHERE id        = ${saleId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!saleRows.rows.length) {
    throw httpError(404, 'Open sale not found');
  }

  await _db.execute(
    sql`DELETE FROM pos_sale_payments WHERE id = ${paymentId} AND sale_id = ${saleId}`
  );
}

// ── finalizeSale ──────────────────────────────────────────────────────────────

export async function finalizeSale(params: {
  tenantId: string;
  saleId: string;
  idempotencyKey: string;
}): Promise<{ invoiceId: string | null }> {
  const { tenantId, saleId, idempotencyKey } = params;

  return _db.transaction(async (tx) => {
    // ── Step 0 — idempotency check (SELECT FOR UPDATE) ────────────────────────
    const saleRows = await tx.execute<{
      id: string;
      status: string;
      invoice_id: string | null;
      idempotency_key: string | null;
      session_id: string;
      cost_center_id: string | null;
      operator_id: string;
      total: string;
      customer_doc: string | null;
    }>(
      sql`SELECT id, status, invoice_id, idempotency_key, session_id,
                 cost_center_id, operator_id, total, customer_doc
          FROM pos_sales
          WHERE id = ${saleId} AND tenant_id = ${tenantId}
          FOR UPDATE`
    );

    if (!saleRows.rows.length) {
      throw httpError(404, 'Sale not found');
    }

    const sale = saleRows.rows[0];

    if (sale.status === 'finalized') {
      if (sale.idempotency_key === idempotencyKey) {
        return { invoiceId: sale.invoice_id };
      }
      throw httpError(409, 'Sale already finalized with a different key');
    }

    if (sale.status === 'cancelled') {
      throw httpError(422, 'Sale is cancelled');
    }

    // ── Step 1 — validate ─────────────────────────────────────────────────────

    // Session must be open
    const sessionRows = await tx.execute(
      sql`SELECT id FROM pos_sessions
          WHERE id        = ${sale.session_id}
            AND tenant_id = ${tenantId}
            AND status    = 'open'
          LIMIT 1`
    );

    if (!sessionRows.rows.length) {
      throw httpError(422, 'Session is not open');
    }

    // At least 1 item
    const itemsResult = await tx.execute<{
      id: string;
      product_id: string;
      quantity: string;
    }>(
      sql`SELECT id, product_id, quantity FROM pos_sale_items WHERE sale_id = ${saleId}`
    );

    if (!itemsResult.rows.length) {
      throw httpError(422, 'Sale has no items');
    }

    // Payments must cover total
    const paidResult = await tx.execute<{ paid: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS paid
          FROM pos_sale_payments WHERE sale_id = ${saleId}`
    );

    const totalPaid = parseFloat(paidResult.rows[0]?.paid ?? '0');
    const saleTotal = parseFloat(sale.total);

    if (totalPaid < saleTotal - 0.001) { // 0.001 tolerance for floating point
      throw httpError(422, 'Payments do not cover total');
    }

    // ── Step 2 — stock exit per item ──────────────────────────────────────────
    if (sale.cost_center_id) {
      for (const item of itemsResult.rows) {
        await applyExit(
          {
            tenantId,
            costCenterId: sale.cost_center_id,
            materialId:   item.product_id,
            quantity:     Number(item.quantity),
            source:       'pos_sale',
            sourceId:     saleId,
            userId:       sale.operator_id,
          },
          tx as unknown as typeof _db
        );
      }
    }

    // ── Step 3 — create invoice (model=65, NFC-e) ─────────────────────────────
    // invoices.client_id is NOT NULL — only create when customer_doc maps to a client
    let invoiceId: string | null = null;

    if (sale.customer_doc) {
      const clientRows = await tx.execute<{ id: string }>(
        sql`SELECT id FROM clients
            WHERE tenant_id = ${tenantId}
              AND (cnpj = ${sale.customer_doc} OR cpf = ${sale.customer_doc})
            LIMIT 1`
      );

      if (clientRows.rows.length) {
        const clientId = clientRows.rows[0].id;

        const [inv] = await tx
          .insert(invoices)
          .values({
            tenant_id:  tenantId,
            client_id:  clientId,
            total:      sale.total,
            subtotal:   sale.total,
            tax_total:  '0',
            model:      65,
            nfe_status: 'pending',
            status:     'draft',
            serie:      '1',
          })
          .returning({ id: invoices.id });

        invoiceId = inv.id;
      }
    }

    // ── Step 4 — cash movement ────────────────────────────────────────────────
    const cashPayments = await tx.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS total
          FROM pos_sale_payments
          WHERE sale_id = ${saleId} AND method = 'cash'`
    );

    const cashTotal = parseFloat(cashPayments.rows[0]?.total ?? '0');

    if (cashTotal > 0) {
      await tx.insert(posCashMovements).values({
        tenant_id:  tenantId,
        session_id: sale.session_id,
        type:       'sale_cash',
        amount:     cashTotal.toFixed(2),
        sale_id:    saleId,
        created_by: sale.operator_id,
      });
    }

    // ── Step 5 — finalize sale ────────────────────────────────────────────────
    await tx.execute(
      sql`UPDATE pos_sales SET
            status          = 'finalized',
            finalized_at    = NOW(),
            idempotency_key = ${idempotencyKey},
            invoice_id      = ${invoiceId},
            updated_at      = NOW()
          WHERE id = ${saleId}`
    );

    return { invoiceId };
  });
}

// ── cancelSale ────────────────────────────────────────────────────────────────

export async function cancelSale(params: {
  tenantId: string;
  saleId: string;
  reason: string;
  operatorId: string;
}): Promise<void> {
  const { tenantId, saleId, reason, operatorId } = params;

  await _db.transaction(async (tx) => {
    // Validate sale belongs to tenant (FOR UPDATE)
    const saleRows = await tx.execute<{
      id: string;
      status: string;
      invoice_id: string | null;
      cost_center_id: string | null;
    }>(
      sql`SELECT id, status, invoice_id, cost_center_id
          FROM pos_sales
          WHERE id = ${saleId} AND tenant_id = ${tenantId}
          FOR UPDATE`
    );

    if (!saleRows.rows.length) {
      throw httpError(404, 'Sale not found');
    }

    const sale = saleRows.rows[0];

    // Already cancelled — no-op
    if (sale.status === 'cancelled') {
      return;
    }

    if (sale.status === 'open') {
      // Simple cancellation — no stock or invoice side-effects
      await tx.execute(
        sql`UPDATE pos_sales SET
              status       = 'cancelled',
              cancelled_at = NOW(),
              cancel_reason = ${reason},
              updated_at   = NOW()
            WHERE id = ${saleId}`
      );
      return;
    }

    // status === 'finalized' — reverse stock and mark invoice
    if (sale.cost_center_id) {
      const itemsResult = await tx.execute<{
        product_id: string;
        quantity: string;
        unit_price: string;
      }>(
        sql`SELECT product_id, quantity, unit_price
            FROM pos_sale_items WHERE sale_id = ${saleId}`
      );

      for (const item of itemsResult.rows) {
        await applyEntry(
          {
            tenantId,
            costCenterId: sale.cost_center_id,
            materialId:   item.product_id,
            quantity:     Number(item.quantity),
            unitCost:     parseFloat(item.unit_price),
            source:       'pos_sale',
            sourceId:     'cancel:' + saleId,
            userId:       operatorId,
          },
          tx as unknown as typeof _db
        );
      }
    }

    if (sale.invoice_id) {
      await tx.execute(
        sql`UPDATE invoices SET nfe_status = 'cancellation_pending'
            WHERE id = ${sale.invoice_id}`
      );
    }

    await tx.execute(
      sql`UPDATE pos_sales SET
            status        = 'cancelled',
            cancelled_at  = NOW(),
            cancel_reason = ${reason},
            updated_at    = NOW()
          WHERE id = ${saleId}`
    );
  });
}
