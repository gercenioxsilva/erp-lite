// Score Fiscal — compõe detector (dono único) + readiness do cadastro +
// pendências de conciliação (reconciliationSummary reusado, sem recontagem).

import { sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { resolveCompanyId } from './companyService';
import { getEmissionReadiness } from './fiscalCompanyConfigService';
import { reconciliationSummary } from './reconciliationService';
import { detectInconsistencies } from './fiscalInconsistencyService';
import { computeFiscalScore } from '../domain/fiscal/scoreDomain';

export type DrizzleDB = typeof _db;

export async function computeScore(tenantId: string, companyId: string | null | undefined, db: DrizzleDB = _db) {
  const company = await resolveCompanyId(tenantId, companyId, db);

  const [findings, readiness, recon, emissions, imports] = await Promise.all([
    detectInconsistencies(tenantId, company.id, null, db),
    getEmissionReadiness(tenantId, company.id, db),
    reconciliationSummary(tenantId, db),
    db.execute<any>(sql`
      SELECT 1 FROM nfse_invoices WHERE tenant_id = ${tenantId} AND nfse_status = 'authorized'
      UNION SELECT 1 FROM invoices WHERE tenant_id = ${tenantId} AND nfe_status = 'authorized' LIMIT 1`),
    db.execute<any>(sql`SELECT 1 FROM import_batches WHERE tenant_id = ${tenantId} LIMIT 1`),
  ]);

  const reconPendingCount = (recon['pending'] ?? 0) + (recon['unmatched'] ?? 0);
  const { score, breakdown } = computeFiscalScore({
    findings, readiness, reconPendingCount,
    hasAnyEmission: emissions.rows.length > 0,
    hasAnyImport: imports.rows.length > 0,
  });

  return { score, breakdown, findings, computedAt: new Date().toISOString() };
}
