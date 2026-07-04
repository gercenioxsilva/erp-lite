// Application Service — Produtividade/SLA por Técnico. Lê service_visits do
// período e delega a agregação por técnico ao domínio puro.

import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './dreService';
import { buildTechnicianProductivity, type VisitInput } from '../domain/technicianProductivity/technicianProductivityDomain';

interface TechnicianProductivityArgs {
  tenantId: string;
  from: string;
  to: string;
}

export async function computeTechnicianProductivity(args: TechnicianProductivityArgs, db: DrizzleDB) {
  const { tenantId, from, to } = args;

  const { rows } = await db.execute<any>(sql`
    SELECT
      sv.technician_id::text AS technician_id,
      t.name                 AS technician_name,
      sv.status               AS status,
      sv.scheduled_at::text   AS scheduled_at,
      sv.checked_in_at::text  AS checked_in_at,
      sv.checked_out_at::text AS checked_out_at
    FROM service_visits sv
    JOIN technicians t ON t.id = sv.technician_id
    WHERE sv.tenant_id = ${tenantId}
      AND sv.scheduled_at::date BETWEEN ${from}::date AND ${to}::date
  `);

  const visits: VisitInput[] = rows.map(r => ({
    technician_id:   String(r.technician_id),
    technician_name: String(r.technician_name),
    status:          String(r.status),
    scheduled_at:    String(r.scheduled_at),
    checked_in_at:   r.checked_in_at ? String(r.checked_in_at) : null,
    checked_out_at:  r.checked_out_at ? String(r.checked_out_at) : null,
  }));

  return buildTechnicianProductivity(visits);
}
