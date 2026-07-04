// Application Service — Receita Recorrente (MRR). Lê service_contracts (foto
// dos contratos ativos em `as_of`, mais novos/encerrados nos 30 dias anteriores)
// e delega a normalização mensal ao domínio puro.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildMrr, type ContractInput } from '../domain/mrr/mrrDomain';

interface MrrArgs {
  tenantId: string;
  asOf: string;
}

const RECENT_WINDOW_DAYS = 30;

function toContracts(rows: any[]): ContractInput[] {
  return rows.map(r => ({ id: String(r.id), amount: Number(r.amount), billing_frequency: String(r.billing_frequency) }));
}

export async function computeMrr(args: MrrArgs, db: DrizzleDB) {
  const { tenantId, asOf } = args;

  const [active, recentlyNew, recentlyChurned] = await Promise.all([
    db.execute<any>(sql`
      SELECT id, amount, billing_frequency FROM service_contracts
      WHERE tenant_id = ${tenantId} AND status = 'active'
        AND start_date <= ${asOf}::date
        AND (end_date IS NULL OR end_date >= ${asOf}::date)
    `),
    db.execute<any>(sql`
      SELECT id, amount, billing_frequency FROM service_contracts
      WHERE tenant_id = ${tenantId}
        AND start_date BETWEEN (${asOf}::date - ${RECENT_WINDOW_DAYS}::int) AND ${asOf}::date
    `),
    db.execute<any>(sql`
      SELECT id, amount, billing_frequency FROM service_contracts
      WHERE tenant_id = ${tenantId}
        AND end_date BETWEEN (${asOf}::date - ${RECENT_WINDOW_DAYS}::int) AND ${asOf}::date
    `),
  ]);

  return buildMrr(asOf, toContracts(active.rows), toContracts(recentlyNew.rows), toContracts(recentlyChurned.rows));
}
