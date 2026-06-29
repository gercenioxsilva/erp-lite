import { sql } from 'drizzle-orm';
import { db as _db } from '../../db';
import {
  posTerminals,
  posSessions,
  posCashMovements,
} from '../../db/schema';

type DrizzleDB = typeof _db;

// ── helpers ───────────────────────────────────────────────────────────────────

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

// ── openSession ───────────────────────────────────────────────────────────────

export async function openSession(params: {
  tenantId: string;
  terminalId: string;
  operatorId: string;
  openingAmount: number;
}): Promise<{ id: string }> {
  const { tenantId, terminalId, operatorId, openingAmount } = params;

  return _db.transaction(async (tx) => {
    // Verify terminal exists and belongs to tenant
    const terminalRows = await tx
      .select({ id: posTerminals.id })
      .from(posTerminals)
      .where(sql`id = ${terminalId} AND tenant_id = ${tenantId} AND is_active = true`);

    if (!terminalRows.length) {
      throw httpError(404, 'Terminal not found');
    }

    // Check no existing open session for this terminal
    const openSessions = await tx.execute(
      sql`SELECT id FROM pos_sessions
          WHERE terminal_id = ${terminalId}
            AND tenant_id   = ${tenantId}
            AND status      = 'open'
          LIMIT 1`
    );

    if (openSessions.rows.length > 0) {
      throw httpError(409, 'Terminal already has an open session');
    }

    // Insert session
    const [session] = await tx
      .insert(posSessions)
      .values({
        tenant_id:      tenantId,
        terminal_id:    terminalId,
        operator_id:    operatorId,
        status:         'open',
        opening_amount: openingAmount.toFixed(2),
      })
      .returning({ id: posSessions.id });

    // Insert opening cash movement
    await tx.insert(posCashMovements).values({
      tenant_id:  tenantId,
      session_id: session.id,
      type:       'opening',
      amount:     openingAmount.toFixed(2),
      created_by: operatorId,
    });

    return { id: session.id };
  });
}

// ── addCashMovement ───────────────────────────────────────────────────────────

export async function addCashMovement(params: {
  tenantId: string;
  sessionId: string;
  type: 'sangria' | 'suprimento';
  amount: number;
  reason?: string;
  operatorId: string;
}): Promise<{ id: string }> {
  const { tenantId, sessionId, type, amount, reason, operatorId } = params;

  // Validate session is open and belongs to tenant
  const sessionRows = await _db.execute(
    sql`SELECT id FROM pos_sessions
        WHERE id        = ${sessionId}
          AND tenant_id = ${tenantId}
          AND status    = 'open'
        LIMIT 1`
  );

  if (!sessionRows.rows.length) {
    throw httpError(404, 'Open session not found');
  }

  const [movement] = await _db
    .insert(posCashMovements)
    .values({
      tenant_id:  tenantId,
      session_id: sessionId,
      type,
      amount:     amount.toFixed(2),
      reason:     reason ?? null,
      created_by: operatorId,
    })
    .returning({ id: posCashMovements.id });

  return { id: movement.id };
}

// ── getSessionSummary ─────────────────────────────────────────────────────────

export async function getSessionSummary(
  sessionId: string,
  tenantId: string
): Promise<{
  sessionId: string;
  openingAmount: string;
  totalSales: string;
  totalCash: string;
  totalSangria: string;
  totalSuprimento: string;
  expectedCash: string;
  byMethod: Record<string, string>;
}> {
  // Fetch session and validate tenant
  const sessionRows = await _db.execute<{
    id: string;
    opening_amount: string;
  }>(
    sql`SELECT id, opening_amount FROM pos_sessions
        WHERE id = ${sessionId} AND tenant_id = ${tenantId}
        LIMIT 1`
  );

  if (!sessionRows.rows.length) {
    throw httpError(404, 'Session not found');
  }

  const session = sessionRows.rows[0];
  const openingAmount = parseFloat(session.opening_amount);

  // Aggregate payments by method for finalized sales in this session
  const paymentsResult = await _db.execute<{
    method: string;
    total: string;
  }>(
    sql`SELECT sp.method, COALESCE(SUM(sp.amount), 0)::text AS total
        FROM pos_sale_payments sp
        JOIN pos_sales s ON s.id = sp.sale_id
        WHERE s.session_id = ${sessionId}
          AND s.tenant_id  = ${tenantId}
          AND s.status     = 'finalized'
        GROUP BY sp.method`
  );

  const byMethod: Record<string, string> = {};
  let totalCash = 0;
  let totalSales = 0;

  for (const row of paymentsResult.rows) {
    const amount = parseFloat(row.total);
    byMethod[row.method] = amount.toFixed(2);
    totalSales += amount;
    if (row.method === 'cash') {
      totalCash = amount;
    }
  }

  // Aggregate sangria / suprimento movements
  const movementsResult = await _db.execute<{
    type: string;
    total: string;
  }>(
    sql`SELECT type, COALESCE(SUM(amount), 0)::text AS total
        FROM pos_cash_movements
        WHERE session_id = ${sessionId}
          AND tenant_id  = ${tenantId}
          AND type IN ('sangria', 'suprimento')
        GROUP BY type`
  );

  let totalSangria = 0;
  let totalSuprimento = 0;

  for (const row of movementsResult.rows) {
    if (row.type === 'sangria') totalSangria = parseFloat(row.total);
    if (row.type === 'suprimento') totalSuprimento = parseFloat(row.total);
  }

  const expectedCash = openingAmount + totalCash + totalSuprimento - totalSangria;

  return {
    sessionId,
    openingAmount:   openingAmount.toFixed(2),
    totalSales:      totalSales.toFixed(2),
    totalCash:       totalCash.toFixed(2),
    totalSangria:    totalSangria.toFixed(2),
    totalSuprimento: totalSuprimento.toFixed(2),
    expectedCash:    expectedCash.toFixed(2),
    byMethod,
  };
}

// ── closeSession ──────────────────────────────────────────────────────────────

export async function closeSession(params: {
  tenantId: string;
  sessionId: string;
  countedAmount: number;
  operatorId: string;
}): Promise<{ id: string; difference: string }> {
  const { tenantId, sessionId, countedAmount, operatorId } = params;

  return _db.transaction(async (tx) => {
    // Validate session is open and belongs to tenant
    const sessionRows = await tx.execute(
      sql`SELECT id, opening_amount FROM pos_sessions
          WHERE id        = ${sessionId}
            AND tenant_id = ${tenantId}
            AND status    = 'open'
          FOR UPDATE`
    );

    if (!sessionRows.rows.length) {
      throw httpError(404, 'Open session not found');
    }

    // Check no open sales for this session
    const openSales = await tx.execute(
      sql`SELECT id FROM pos_sales
          WHERE session_id = ${sessionId}
            AND tenant_id  = ${tenantId}
            AND status     = 'open'
          LIMIT 1`
    );

    if (openSales.rows.length > 0) {
      throw httpError(422, 'Cannot close session with open sales');
    }

    // Compute expected cash inline (avoids nested transaction)
    const sessionRow = sessionRows.rows[0] as { id: string; opening_amount: string };
    const openingAmount = parseFloat(sessionRow.opening_amount);

    const cashResult = await tx.execute<{ method: string; total: string }>(
      sql`SELECT sp.method, COALESCE(SUM(sp.amount), 0)::text AS total
          FROM pos_sale_payments sp
          JOIN pos_sales s ON s.id = sp.sale_id
          WHERE s.session_id = ${sessionId}
            AND s.tenant_id  = ${tenantId}
            AND s.status     = 'finalized'
            AND sp.method    = 'cash'
          GROUP BY sp.method`
    );

    const movResult = await tx.execute<{ type: string; total: string }>(
      sql`SELECT type, COALESCE(SUM(amount), 0)::text AS total
          FROM pos_cash_movements
          WHERE session_id = ${sessionId}
            AND tenant_id  = ${tenantId}
            AND type IN ('sangria', 'suprimento')
          GROUP BY type`
    );

    const totalCash = cashResult.rows.length
      ? parseFloat(cashResult.rows[0].total)
      : 0;

    let sangria = 0;
    let suprimento = 0;
    for (const row of movResult.rows) {
      if ((row as { type: string; total: string }).type === 'sangria') sangria = parseFloat((row as { type: string; total: string }).total);
      if ((row as { type: string; total: string }).type === 'suprimento') suprimento = parseFloat((row as { type: string; total: string }).total);
    }

    const closingExpected = openingAmount + totalCash + suprimento - sangria;
    const difference = countedAmount - closingExpected;

    // Insert closing cash movement
    await tx.insert(posCashMovements).values({
      tenant_id:  tenantId,
      session_id: sessionId,
      type:       'closing',
      amount:     countedAmount.toFixed(2),
      created_by: operatorId,
    });

    // Update session to closed
    await tx.execute(
      sql`UPDATE pos_sessions SET
            status           = 'closed',
            closed_at        = NOW(),
            closing_counted  = ${countedAmount.toFixed(2)},
            closing_expected = ${closingExpected.toFixed(2)},
            difference       = ${difference.toFixed(2)}
          WHERE id = ${sessionId}`
    );

    return { id: sessionId, difference: difference.toFixed(2) };
  });
}
