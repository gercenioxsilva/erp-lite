// Application Service — Funil de Conversão de Propostas. Lê proposals do
// período (status + rejected_reason) e delega a agregação ao domínio puro.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildProposalsFunnel, type ProposalRow } from '../domain/proposalsFunnel/proposalsFunnelDomain';

interface ProposalsFunnelArgs {
  tenantId: string;
  from: string;
  to: string;
}

export async function computeProposalsFunnel(args: ProposalsFunnelArgs, db: DrizzleDB) {
  const { tenantId, from, to } = args;

  const { rows } = await db.execute<any>(sql`
    SELECT status, rejected_reason
    FROM proposals
    WHERE tenant_id = ${tenantId}
      AND created_at::date BETWEEN ${from}::date AND ${to}::date
  `);

  const proposalRows: ProposalRow[] = rows.map(r => ({
    status: String(r.status),
    rejected_reason: r.rejected_reason ? String(r.rejected_reason) : null,
  }));

  return buildProposalsFunnel(from, to, proposalRows);
}
