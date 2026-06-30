import { sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import {
  posSales,
  posSaleItems,
  posSalePayments,
  posCashMovements,
  materials,
} from '../../db/schema';
import { applyExit, applyEntry } from '../costCenterStock';
import { applyInventoryExit, applyInventoryReturn } from '../inventory/inventoryLedger';
import { emitirNFCe, cancelarNFCe } from '../fiscal/focusNfe';

// ── helpers ───────────────────────────────────────────────────────────────────

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// Regras de liquidação por forma de pagamento → contas a receber.
// Dinheiro/voucher liquidam na hora (status 'paid'); cartão/pix/crediário viram
// "a receber" (status 'pending') com prazo conforme a origem do recebimento.
type PosPaymentMethod = 'cash' | 'debit' | 'credit' | 'pix' | 'voucher' | 'store_credit';

const POS_PAYMENT_SETTLEMENT: Record<PosPaymentMethod, { settled: boolean; dueDays: number; label: string }> = {
  cash:         { settled: true,  dueDays: 0,  label: 'Venda PDV (dinheiro)' },
  voucher:      { settled: true,  dueDays: 0,  label: 'Venda PDV (voucher)' },
  debit:        { settled: false, dueDays: 1,  label: 'Venda PDV (cartão débito) — adquirente' },
  pix:          { settled: false, dueDays: 1,  label: 'Venda PDV (PIX) — adquirente' },
  credit:       { settled: false, dueDays: 30, label: 'Venda PDV (cartão crédito) — adquirente' },
  store_credit: { settled: false, dueDays: 30, label: 'Venda PDV (crediário) — cliente' },
};

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
}): Promise<{ focusRef: string | null }> {
  const { tenantId, saleId, idempotencyKey } = params;

  await _db.transaction(async (tx) => {
    const saleRows = await tx.execute<{
      id: string;
      status: string;
      focus_ref: string | null;
      idempotency_key: string | null;
      session_id: string;
      cost_center_id: string | null;
      operator_id: string;
      total: string;
      customer_doc: string | null;
      customer_name: string | null;
    }>(
      sql`SELECT id, status, focus_ref, idempotency_key, session_id,
                 cost_center_id, operator_id, total, customer_doc, customer_name
          FROM pos_sales
          WHERE id = ${saleId} AND tenant_id = ${tenantId}
          FOR UPDATE`
    );

    if (!saleRows.rows.length) throw httpError(404, 'Sale not found');
    const sale = saleRows.rows[0];

    if (sale.status === 'finalized') {
      if (sale.idempotency_key === idempotencyKey) return;
      throw httpError(409, 'Sale already finalized with a different key');
    }
    if (sale.status === 'cancelled') throw httpError(422, 'Sale is cancelled');

    const sessionRows = await tx.execute(
      sql`SELECT id FROM pos_sessions
          WHERE id = ${sale.session_id} AND tenant_id = ${tenantId} AND status = 'open'
          LIMIT 1`
    );
    if (!sessionRows.rows.length) throw httpError(422, 'Session is not open');

    const itemsResult = await tx.execute<{
      id: string; product_id: string; quantity: string;
    }>(sql`SELECT id, product_id, quantity FROM pos_sale_items WHERE sale_id = ${saleId}`);
    if (!itemsResult.rows.length) throw httpError(422, 'Sale has no items');

    const paidResult = await tx.execute<{ paid: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS paid FROM pos_sale_payments WHERE sale_id = ${saleId}`
    );
    const totalPaid = parseFloat(paidResult.rows[0]?.paid ?? '0');
    const saleTotal = parseFloat(sale.total);
    if (totalPaid < saleTotal - 0.001) throw httpError(422, 'Payments do not cover total');

    // Estoque geral (inventory + inventory_movements) — SEMPRE, independente de CC.
    for (const item of itemsResult.rows) {
      await applyInventoryExit(tx as unknown as typeof _db, {
        tenantId,
        materialId:  item.product_id,
        quantity:    Number(item.quantity),
        referenceId: saleId,
        referenceType: 'pos_sale',
        reason:      'Venda PDV',
        createdBy:   sale.operator_id,
      });
    }

    // Estoque por centro de custo (camada de custeio) — apenas se o terminal tiver CC.
    if (sale.cost_center_id) {
      for (const item of itemsResult.rows) {
        await applyExit(
          {
            tenantId, costCenterId: sale.cost_center_id, materialId: item.product_id,
            quantity: Number(item.quantity), source: 'pos_sale', sourceId: saleId,
            userId: sale.operator_id,
          },
          tx as unknown as typeof _db
        );
      }
    }

    const cashPayments = await tx.execute<{ total: string }>(
      sql`SELECT COALESCE(SUM(amount), 0)::text AS total
          FROM pos_sale_payments WHERE sale_id = ${saleId} AND method = 'cash'`
    );
    const cashTotal = parseFloat(cashPayments.rows[0]?.total ?? '0');
    if (cashTotal > 0) {
      await tx.insert(posCashMovements).values({
        tenant_id: tenantId, session_id: sale.session_id,
        type: 'sale_cash', amount: cashTotal.toFixed(2),
        sale_id: saleId, created_by: sale.operator_id,
      });
    }

    // Contas a receber — uma por forma de pagamento, vinculada à venda (pos_sale_id).
    // Receita PDV passa a refletir no Dashboard / Fluxo de Caixa / Relatórios.
    const paymentsResult = await tx.execute<{
      method: string; amount: string; installments: number; change_amount: string;
    }>(
      sql`SELECT method, amount, installments, change_amount
          FROM pos_sale_payments WHERE sale_id = ${saleId}`
    );

    const customerSuffix = sale.customer_name ? ` — ${sale.customer_name}` : '';
    for (const pay of paymentsResult.rows) {
      const rule = POS_PAYMENT_SETTLEMENT[pay.method as PosPaymentMethod]
        ?? { settled: false, dueDays: 0, label: 'Venda PDV' };
      // Valor líquido recebido (desconta troco — relevante apenas para dinheiro).
      const net = Number(pay.amount) - Number(pay.change_amount);
      if (net <= 0) continue;
      const amount = net.toFixed(2);
      const installmentsSuffix = pay.method === 'credit' && pay.installments > 1 ? ` ${pay.installments}x` : '';
      const description = `${rule.label}${installmentsSuffix}${customerSuffix}`.slice(0, 255);

      const recvRows = await tx.execute<{ id: string }>(
        sql`INSERT INTO receivables
              (tenant_id, pos_sale_id, cost_center_id, description, amount, paid_amount, due_date, status)
            VALUES (
              ${tenantId}, ${saleId}, ${sale.cost_center_id},
              ${description}, ${amount}, ${rule.settled ? amount : '0'},
              CURRENT_DATE + (${rule.dueDays})::int, ${rule.settled ? 'paid' : 'pending'}
            )
            RETURNING id`
      );

      if (rule.settled) {
        await tx.execute(
          sql`INSERT INTO receivable_payments
                (tenant_id, receivable_id, payment_date, amount, payment_method)
              VALUES (${tenantId}, ${recvRows.rows[0].id}, CURRENT_DATE, ${amount}, ${pay.method})`
        );
      }
    }

    await tx.execute(
      sql`UPDATE pos_sales SET
            status          = 'finalized',
            finalized_at    = NOW(),
            idempotency_key = ${idempotencyKey},
            focus_ref       = ${saleId},
            fiscal_status   = 'processando',
            updated_at      = NOW()
          WHERE id = ${saleId}`
    );
  });

  // NFC-e emission OUTSIDE transaction — failure never rolls back the sale
  emitirNFCe(saleId, tenantId)
    .then(async (result) => {
      await _db.execute(
        sql`UPDATE pos_sales SET
              fiscal_status    = ${result.fiscal_status},
              fiscal_chave     = ${result.fiscal_chave},
              fiscal_protocol  = ${result.fiscal_protocol},
              fiscal_number    = ${result.fiscal_number},
              fiscal_series    = ${result.fiscal_series},
              fiscal_qrcode    = ${result.fiscal_qrcode},
              fiscal_url_danfe = ${result.fiscal_url_danfe},
              fiscal_url_xml   = ${result.fiscal_url_xml},
              fiscal_message   = ${result.fiscal_message},
              updated_at       = NOW()
            WHERE id = ${saleId}`
      );
    })
    .catch(async (err: unknown) => {
      console.error('[Focus NF-e] Post-sale emission failed:', err);
      await _db.execute(
        sql`UPDATE pos_sales SET
              fiscal_status  = 'erro_autorizacao',
              fiscal_message = ${err instanceof Error ? err.message : 'Erro na emissão NFC-e'},
              updated_at     = NOW()
            WHERE id = ${saleId}`
      );
    });

  return { focusRef: saleId };
}

// ── cancelSale ────────────────────────────────────────────────────────────────

export async function cancelSale(params: {
  tenantId: string;
  saleId: string;
  reason: string;
  operatorId: string;
}): Promise<void> {
  const { tenantId, saleId, reason, operatorId } = params;

  // Read before transaction to use for post-transaction Focus cancel
  const preSaleRows = await _db.execute<{
    id: string; status: string; focus_ref: string | null; fiscal_status: string;
    cost_center_id: string | null;
  }>(
    sql`SELECT id, status, focus_ref, fiscal_status, cost_center_id
        FROM pos_sales WHERE id = ${saleId} AND tenant_id = ${tenantId} LIMIT 1`
  );
  if (!preSaleRows.rows.length) throw httpError(404, 'Sale not found');
  const saleSnap = preSaleRows.rows[0];

  await _db.transaction(async (tx) => {
    const saleRows = await tx.execute<{
      id: string; status: string; cost_center_id: string | null;
    }>(
      sql`SELECT id, status, cost_center_id
          FROM pos_sales WHERE id = ${saleId} AND tenant_id = ${tenantId}
          FOR UPDATE`
    );
    if (!saleRows.rows.length) throw httpError(404, 'Sale not found');
    const sale = saleRows.rows[0];

    if (sale.status === 'cancelled') return;

    if (sale.status === 'open') {
      await tx.execute(
        sql`UPDATE pos_sales SET
              status        = 'cancelled',
              cancelled_at  = NOW(),
              cancel_reason = ${reason},
              updated_at    = NOW()
            WHERE id = ${saleId}`
      );
      return;
    }

    // finalized — estorna estoque e cancela contas a receber vinculadas
    const itemsResult = await tx.execute<{
      product_id: string; quantity: string; unit_price: string;
    }>(sql`SELECT product_id, quantity, unit_price FROM pos_sale_items WHERE sale_id = ${saleId}`);

    // Estoque geral (inventory) — SEMPRE
    for (const item of itemsResult.rows) {
      await applyInventoryReturn(tx as unknown as typeof _db, {
        tenantId,
        materialId:  item.product_id,
        quantity:    Number(item.quantity),
        referenceId: saleId,
        referenceType: 'pos_sale',
        reason:      'Venda PDV cancelada',
        createdBy:   operatorId,
      });
    }

    // Estoque por centro de custo — apenas se houver CC
    if (sale.cost_center_id) {
      for (const item of itemsResult.rows) {
        await applyEntry(
          {
            tenantId, costCenterId: sale.cost_center_id, materialId: item.product_id,
            quantity: Number(item.quantity), unitCost: parseFloat(item.unit_price),
            source: 'pos_sale', sourceId: 'cancel:' + saleId, userId: operatorId,
          },
          tx as unknown as typeof _db
        );
      }
    }

    // Cancela contas a receber ainda não liquidadas. Recebíveis já pagos (dinheiro/
    // voucher) permanecem — exigem nota de crédito / estorno financeiro manual.
    await tx.execute(
      sql`UPDATE receivables SET status = 'cancelled', updated_at = NOW()
          WHERE pos_sale_id = ${saleId} AND tenant_id = ${tenantId} AND status <> 'paid'`
    );

    await tx.execute(
      sql`UPDATE pos_sales SET
            status        = 'cancelled',
            cancelled_at  = NOW(),
            cancel_reason = ${reason},
            updated_at    = NOW()
          WHERE id = ${saleId}`
    );
  });

  // Cancel NFC-e via Focus if it was authorized (OUTSIDE transaction)
  if (saleSnap.status === 'finalized' && saleSnap.fiscal_status === 'autorizado' && saleSnap.focus_ref) {
    const just = reason.length >= 15 ? reason : reason.padEnd(15, ' ');
    cancelarNFCe(saleSnap.focus_ref, just)
      .then(async (result) => {
        await _db.execute(
          sql`UPDATE pos_sales SET
                fiscal_status  = ${result.fiscal_status},
                fiscal_message = ${result.fiscal_message},
                updated_at     = NOW()
              WHERE id = ${saleId}`
        );
      })
      .catch((err: unknown) => {
        console.error('[Focus NF-e] NFC-e cancellation failed:', err);
      });
  }
}

// ── reemitirFiscal ────────────────────────────────────────────────────────────

export async function reemitirFiscal(params: {
  tenantId: string;
  saleId: string;
}): Promise<void> {
  const { tenantId, saleId } = params;

  const saleRows = await _db.execute<{
    id: string; status: string; fiscal_status: string;
  }>(
    sql`SELECT id, status, fiscal_status
        FROM pos_sales WHERE id = ${saleId} AND tenant_id = ${tenantId} LIMIT 1`
  );
  if (!saleRows.rows.length) throw httpError(404, 'Sale not found');
  const sale = saleRows.rows[0];

  if (sale.status !== 'finalized') throw httpError(422, 'Sale is not finalized');
  if (sale.fiscal_status === 'autorizado') throw httpError(422, 'NFC-e already authorized');

  await _db.execute(
    sql`UPDATE pos_sales SET fiscal_status = 'processando', focus_ref = ${saleId}, updated_at = NOW()
        WHERE id = ${saleId}`
  );

  emitirNFCe(saleId, tenantId)
    .then(async (result) => {
      await _db.execute(
        sql`UPDATE pos_sales SET
              fiscal_status    = ${result.fiscal_status},
              fiscal_chave     = ${result.fiscal_chave},
              fiscal_protocol  = ${result.fiscal_protocol},
              fiscal_number    = ${result.fiscal_number},
              fiscal_series    = ${result.fiscal_series},
              fiscal_qrcode    = ${result.fiscal_qrcode},
              fiscal_url_danfe = ${result.fiscal_url_danfe},
              fiscal_url_xml   = ${result.fiscal_url_xml},
              fiscal_message   = ${result.fiscal_message},
              updated_at       = NOW()
            WHERE id = ${saleId}`
      );
    })
    .catch(async (err: unknown) => {
      console.error('[Focus NF-e] Re-emission failed:', err);
      await _db.execute(
        sql`UPDATE pos_sales SET
              fiscal_status  = 'erro_autorizacao',
              fiscal_message = ${err instanceof Error ? err.message : 'Erro na emissão NFC-e'},
              updated_at     = NOW()
            WHERE id = ${saleId}`
      );
    });
}
