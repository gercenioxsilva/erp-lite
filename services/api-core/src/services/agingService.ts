// Application Service — Aging (posição de vencimentos) de contas a receber ou a
// pagar. Lê os títulos em aberto (status pending/partial), calcula saldo restante
// e dias de atraso relativos a `as_of`, e delega o agrupamento por faixa ao
// domínio puro buildAging.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildAging, type AgingItemInput } from '../domain/aging/agingDomain';

interface AgingArgs {
  tenantId: string;
  type:     'receivable' | 'payable';
  asOf:     string; // YYYY-MM-DD
}

export async function computeAging(args: AgingArgs, db: DrizzleDB) {
  const { tenantId, type, asOf } = args;

  const query = type === 'receivable'
    ? sql`
        SELECT
          r.id::text                                          AS id,
          COALESCE(c.trade_name, c.company_name, c.full_name) AS party_name,
          r.description                                       AS description,
          r.due_date::text                                    AS due_date,
          (r.amount - r.paid_amount)                          AS remaining,
          (${asOf}::date - r.due_date::date)                  AS days_overdue
        FROM receivables r
        LEFT JOIN clients c ON c.id = r.client_id
        WHERE r.tenant_id = ${tenantId} AND r.status IN ('pending','partial')
        ORDER BY r.due_date ASC
      `
    : sql`
        SELECT
          p.id::text                          AS id,
          p.supplier_name                     AS party_name,
          p.description                       AS description,
          p.due_date::text                    AS due_date,
          (p.amount - p.paid_amount)          AS remaining,
          (${asOf}::date - p.due_date::date)  AS days_overdue
        FROM payables p
        WHERE p.tenant_id = ${tenantId} AND p.status IN ('pending','partial')
        ORDER BY p.due_date ASC
      `;

  const { rows } = await db.execute<{
    id: string; party_name: string | null; description: string;
    due_date: string; remaining: string; days_overdue: number;
  }>(query);

  const items: AgingItemInput[] = rows.map(r => ({
    id:           String(r.id),
    party_name:   r.party_name ? String(r.party_name) : null,
    description:  String(r.description),
    due_date:     String(r.due_date),
    remaining:    Number(r.remaining),
    days_overdue: Number(r.days_overdue),
  }));

  return buildAging(type, asOf, items);
}
