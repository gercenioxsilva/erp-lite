// Coleta tenant-scoped para o detector de inconsistências (dono único dos
// checks = domain/fiscal/inconsistencyDomain). Consumido pelo Score, pelos
// alertas (mapeamento p/ fiscal_alerts) e pelo robô de fechamento (gate).

import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { resolveCompanyId } from './companyService';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import {
  runInconsistencyChecks, InconsistencyFinding, ChecksInput,
} from '../domain/fiscal/inconsistencyDomain';

export type DrizzleDB = typeof _db;

export async function detectInconsistencies(
  tenantId: string, companyId: string | null | undefined, competencia: string | null, db: DrizzleDB = _db,
): Promise<InconsistencyFinding[]> {
  const company = await resolveCompanyId(tenantId, companyId, db);
  const config = await getOrCreateConfig(tenantId, company.id, db);

  const compFilter = competencia ? sql` AND to_char(rp.payment_date, 'YYYY-MM') = ${competencia}` : sql``;

  const [paymentsWithoutDoc, unpaidNfse, unpaidInvoices, cardVsNotes, issMismatches, semServiceCode, cnae, dasSeries] = await Promise.all([
    // Recebimento sem documento fiscal vinculado (janela: 90 dias ou a competência).
    db.execute<any>(sql`
      SELECT rp.id, rp.amount, rp.payment_date
      FROM receivable_payments rp
      JOIN receivables r ON r.id = rp.receivable_id
      WHERE rp.tenant_id = ${tenantId}
        AND r.invoice_id IS NULL AND r.pos_sale_id IS NULL AND r.service_order_id IS NULL AND r.boleto_id IS NULL
        AND rp.payment_date >= CURRENT_DATE - INTERVAL '90 days'${compFilter}
      LIMIT 50`),
    // NFS-e autorizada com recebível ainda aberto.
    db.execute<any>(sql`
      SELECT n.id, n.amount, n.nfse_auth_date,
             EXTRACT(DAY FROM NOW() - n.nfse_auth_date)::int AS days_open
      FROM nfse_invoices n
      JOIN receivables r ON r.id = n.receivable_id
      WHERE n.tenant_id = ${tenantId} AND n.company_id = ${company.id}
        AND n.nfse_status = 'authorized' AND r.status IN ('pending','partial')
        AND n.nfse_auth_date < NOW() - INTERVAL '30 days'
      LIMIT 50`),
    // NF-e emitida com recebível aberto.
    db.execute<any>(sql`
      SELECT i.id, i.total AS amount, i.nfe_auth_date,
             EXTRACT(DAY FROM NOW() - i.nfe_auth_date)::int AS days_open
      FROM invoices i
      JOIN receivables r ON r.invoice_id = i.id
      WHERE i.tenant_id = ${tenantId} AND i.nfe_status = 'authorized'
        AND r.status IN ('pending','partial') AND i.nfe_auth_date < NOW() - INTERVAL '30 days'
      LIMIT 50`),
    // Maquininha (conciliadas) × receita de notas, por competência (últimos 3 meses).
    db.execute<any>(sql`
      SELECT comp AS competencia, SUM(card) AS card_revenue, SUM(notes) AS notes_revenue FROM (
        SELECT to_char(t.occurred_at, 'YYYY-MM') AS comp, COALESCE(t.gross_amount, t.amount) AS card, 0::numeric AS notes
        FROM imported_transactions t
        WHERE t.tenant_id = ${tenantId} AND t.company_id = ${company.id}
          AND t.source = 'acquirer' AND t.reconciliation_status = 'matched'
          AND t.occurred_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '3 months'
        UNION ALL
        SELECT f.competencia, 0, f.receita_bruta
        FROM fiscal_revenue_monthly f
        WHERE f.tenant_id = ${tenantId} AND f.company_id = ${company.id}
          AND f.competencia >= to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '3 months', 'YYYY-MM')
      ) x GROUP BY comp ORDER BY comp`),
    // ISS retido divergente do default do cadastro.
    db.execute<any>(sql`
      SELECT n.id, n.iss_retido FROM nfse_invoices n
      WHERE n.tenant_id = ${tenantId} AND n.company_id = ${company.id}
        AND n.nfse_status = 'authorized' AND n.iss_retido <> ${config.iss_retido_padrao}
        AND n.created_at >= NOW() - INTERVAL '90 days'
      LIMIT 20`),
    // NFS-e sem código de serviço.
    db.execute<any>(sql`
      SELECT n.id FROM nfse_invoices n
      WHERE n.tenant_id = ${tenantId} AND n.company_id = ${company.id}
        AND (n.service_code IS NULL OR n.service_code = '')
        AND n.created_at >= NOW() - INTERVAL '90 days'
      LIMIT 20`),
    db.execute<any>(sql`
      SELECT 1 FROM fiscal_company_cnae WHERE company_id = ${company.id} AND is_principal LIMIT 1`),
    db.execute<any>(sql`
      SELECT competencia, id, das_total FROM simples_apuracao
      WHERE tenant_id = ${tenantId} AND company_id = ${company.id}
      ORDER BY competencia ASC LIMIT 24`),
  ]);

  const input: ChecksInput = {
    competencia,
    paymentsWithoutDoc: paymentsWithoutDoc.rows.map((r: any) => ({
      id: r.id, amount: Number(r.amount), paymentDate: String(r.payment_date).slice(0, 10),
    })),
    unpaidInvoices: [
      ...unpaidNfse.rows.map((r: any) => ({ id: r.id, kind: 'nfse' as const, amount: Number(r.amount), authDate: String(r.nfse_auth_date), daysOpen: Number(r.days_open) })),
      ...unpaidInvoices.rows.map((r: any) => ({ id: r.id, kind: 'invoice' as const, amount: Number(r.amount), authDate: String(r.nfe_auth_date), daysOpen: Number(r.days_open) })),
    ],
    cardVsNotes: cardVsNotes.rows.map((r: any) => ({
      competencia: String(r.competencia).trim(), cardRevenue: Number(r.card_revenue), notesRevenue: Number(r.notes_revenue),
    })),
    issMismatches: issMismatches.rows.map((r: any) => ({
      id: r.id, issRetidoNota: !!r.iss_retido, issRetidoConfig: config.iss_retido_padrao,
    })),
    nfseSemServiceCode: semServiceCode.rows.map((r: any) => ({ id: r.id })),
    hasCnaePrincipal: cnae.rows.length > 0,
    configId: config.id,
    dasSeries: dasSeries.rows.map((r: any) => ({
      competencia: String(r.competencia).trim(), apuracaoId: r.id, dasTotal: Number(r.das_total),
    })),
  };

  return runInconsistencyChecks(input);
}
