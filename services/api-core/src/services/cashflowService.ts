// Application Service — Fluxo de Caixa (Realizado vs. Projetado).
// Lê receivable_payments/payable_payments (realizado) e receivables/payables em
// aberto (projetado), agrega por bucket (semana ou mês) e delega a totalização
// para o domínio puro buildCashflow.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildCashflow, type CashflowBucketInput, type CashflowGranularity } from '../domain/cashflow/cashflowDomain';

interface CashflowArgs {
  tenantId:    string;
  from:        string; // YYYY-MM-DD
  to:          string; // YYYY-MM-DD
  granularity: CashflowGranularity;
}

export async function computeCashflow(args: CashflowArgs, db: DrizzleDB) {
  const { tenantId, from, to, granularity } = args;
  const unit = granularity === 'week' ? 'week' : 'month';
  const step = granularity === 'week' ? '1 week' : '1 month';

  // Saldo de abertura: caixa realizado acumulado antes do início do período.
  const { rows: [openRow] } = await db.execute<{ opening: string }>(sql`
    SELECT
      (SELECT COALESCE(SUM(amount), 0) FROM receivable_payments
        WHERE tenant_id = ${tenantId} AND payment_date < ${from}::date)
    - (SELECT COALESCE(SUM(amount), 0) FROM payable_payments
        WHERE tenant_id = ${tenantId} AND payment_date < ${from}::date) AS opening
  `);
  const openingBalance = Number(openRow?.opening ?? 0);

  const { rows } = await db.execute<{
    period: string; realized_inflow: string; realized_outflow: string;
    projected_inflow: string; projected_outflow: string;
  }>(sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${unit}, ${from}::timestamp),
        date_trunc(${unit}, ${to}::timestamp),
        ${step}::interval
      )::date AS period
    ),
    ri AS (
      SELECT date_trunc(${unit}, payment_date::timestamp)::date AS period, SUM(amount) AS total
      FROM receivable_payments
      WHERE tenant_id = ${tenantId} AND payment_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    ),
    ro AS (
      SELECT date_trunc(${unit}, payment_date::timestamp)::date AS period, SUM(amount) AS total
      FROM payable_payments
      WHERE tenant_id = ${tenantId} AND payment_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    ),
    pi AS (
      SELECT date_trunc(${unit}, due_date::timestamp)::date AS period, SUM(amount - paid_amount) AS total
      FROM receivables
      WHERE tenant_id = ${tenantId} AND status IN ('pending','partial')
        AND due_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    ),
    po AS (
      SELECT date_trunc(${unit}, due_date::timestamp)::date AS period, SUM(amount - paid_amount) AS total
      FROM payables
      WHERE tenant_id = ${tenantId} AND status IN ('pending','partial')
        AND due_date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1
    )
    SELECT
      b.period::text                 AS period,
      COALESCE(ri.total, 0)          AS realized_inflow,
      COALESCE(ro.total, 0)          AS realized_outflow,
      COALESCE(pi.total, 0)          AS projected_inflow,
      COALESCE(po.total, 0)          AS projected_outflow
    FROM buckets b
    LEFT JOIN ri ON ri.period = b.period
    LEFT JOIN ro ON ro.period = b.period
    LEFT JOIN pi ON pi.period = b.period
    LEFT JOIN po ON po.period = b.period
    ORDER BY b.period
  `);

  const bucketInputs: CashflowBucketInput[] = rows.map(r => ({
    period:            String(r.period),
    realized_inflow:   Number(r.realized_inflow),
    realized_outflow:  Number(r.realized_outflow),
    projected_inflow:  Number(r.projected_inflow),
    projected_outflow: Number(r.projected_outflow),
  }));

  return buildCashflow(from, to, granularity, openingBalance, bucketInputs);
}
