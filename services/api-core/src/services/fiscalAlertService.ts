// Central de alertas fiscais (0076) — camada de serviço.
// evaluateAndPersist: snapshot (reusando estimadoVsPago/reconciliationSummary/
// cert/registry — nunca recontagem) + regras temporais + findings do detector
// (dono único) → INSERT catch-23505 → touch last_detected_at; autoResolve
// quando o fato some; e-mail incondicional SÓ para critical (1x, email_sent).
// Consumido pelo worker diário E pelo robô de fechamento (mesma função).

import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalAlerts, fiscalCertificates, nfseMunicipalities, nfeConfigs } from '../db/schema';
import { resolveCompanyId } from './companyService';
import { getOrCreateConfig } from './fiscalCompanyConfigService';
import { estimadoVsPago, loadBrackets, folha12m } from './apuracaoService';
import { resolveRbt12 } from './fiscalRevenueService';
import { detectInconsistencies } from './fiscalInconsistencyService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { sendSystemNotification } from '../lib/notificationsClient';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import {
  evaluateAlertRules, mapFindingToCandidate, buildDedupeKey, AlertCandidate, AlertSnapshot,
} from '../domain/fiscal/alertRulesDomain';
import { windowCompetencias } from '../domain/simples/simplesDomain';

export type DrizzleDB = typeof _db;
export type FiscalAlert = typeof fiscalAlerts.$inferSelect;

export class AlertError extends Error {
  constructor(public code: string) { super(code); this.name = 'AlertError'; }
}

async function loadSnapshot(tenantId: string, companyId: string, db: DrizzleDB): Promise<AlertSnapshot> {
  const config = await getOrCreateConfig(tenantId, companyId, db);
  const hoje = new Date();
  const competencia = hoje.toISOString().slice(0, 7);

  const [evp, [cert], [company]] = await Promise.all([
    // POR EMPRESA: sem o companyId o pago vinha tenant-wide e o pago inflado por
    // empresas irmãs suprimia o alerta de DAS não pago desta empresa.
    estimadoVsPago(tenantId, companyId, db),
    db.select({ not_after: fiscalCertificates.not_after }).from(fiscalCertificates)
      .where(and(eq(fiscalCertificates.company_id, companyId), eq(fiscalCertificates.is_active, true))),
    db.select({ ibge: nfeConfigs.codigo_municipio_ibge }).from(nfeConfigs).where(eq(nfeConfigs.id, companyId)),
  ]);

  // Apurações sem pagamento (estimado > pago), com id p/ ref.
  const { rows: apuracoes } = await db.execute<any>(sql`
    SELECT a.id, a.competencia, a.das_total FROM simples_apuracao a
    WHERE a.tenant_id = ${tenantId} AND a.company_id = ${companyId}
    ORDER BY a.competencia DESC LIMIT 6`);
  const pagoPor = new Map(evp.map((r) => [r.competencia, r.pago]));
  const apuracoesSemPagamento = apuracoes
    .filter((a: any) => (pagoPor.get(String(a.competencia).trim()) ?? 0) < Number(a.das_total))
    .map((a: any) => ({ apuracaoId: a.id, competencia: String(a.competencia).trim(), dasTotal: Number(a.das_total) }));

  // RBT12 atual vs anterior (faixa via brackets — nunca memoria jsonb).
  let rbt12Atual: number | null = null, rbt12Anterior: number | null = null, brackets = null;
  try {
    rbt12Atual = (await resolveRbt12(tenantId, companyId, competencia, config, db)).rbt12;
    const anterior = windowCompetencias(competencia, 1)[0];
    rbt12Anterior = (await resolveRbt12(tenantId, companyId, anterior, config, db)).rbt12;
    const anexo = config.anexo_padrao ? ['I', 'II', 'III', 'IV', 'V'][config.anexo_padrao - 1] : 'III';
    brackets = await loadBrackets(anexo, hoje.getFullYear(), db);
  } catch { /* sem receita/bootstrap: regras de faixa não avaliam */ }

  let fatorRAtual: number | null = null;
  if (config.fator_r_aplicavel && rbt12Atual) {
    const folha = await folha12m(tenantId, companyId, competencia, db);
    if (folha.meses >= 12 && rbt12Atual > 0) fatorRAtual = Math.round((folha.total / rbt12Atual) * 10000) / 10000;
  }

  let municipioCadastrado = true;
  if (config.nfse_provider !== 'focus' && company?.ibge) {
    const [m] = await db.select({ ok: nfseMunicipalities.ativo }).from(nfseMunicipalities)
      .where(eq(nfseMunicipalities.codigo_ibge, company.ibge));
    municipioCadastrado = !!m?.ok;
  }

  return {
    today: hoje, apuracoesSemPagamento,
    certValidTo: cert?.not_after ?? null,
    rbt12Atual, rbt12Anterior, brackets, fatorRAtual,
    municipioCadastrado, codigoIbge: company?.ibge ?? null,
    avisoDiasDas: 8, avisoDiasCert: 30,
  };
}

async function persistCandidate(
  tenantId: string, companyId: string | null, c: AlertCandidate, db: DrizzleDB,
): Promise<'raised' | 'deduped'> {
  const dedupe = buildDedupeKey(c);
  try {
    const [row] = await db.insert(fiscalAlerts).values({
      tenant_id: tenantId, company_id: companyId,
      rule_key: c.ruleKey, severity: c.severity, title: c.title.slice(0, 200),
      detail: c.detail ?? null, payload: c.payload ?? null,
      ref_type: c.refType ?? null, ref_id: c.refId ?? null,
      periodo: c.periodo ?? null, dedupe_key: dedupe,
    }).returning();
    await recordFiscalEvent({
      tenantId, companyId, aggregateType: 'alert', aggregateId: row.id,
      eventType: 'alert_raised', requestPayload: { rule: c.ruleKey, severity: c.severity },
      idempotencyKey: `alert_raised:${dedupe}:${row.id}`,
    }, db);
    // E-mail incondicional SÓ p/ critical, 1x — destinatário: owner do tenant.
    if (c.severity === 'critical') {
      const { rows } = await db.execute<any>(sql`
        SELECT email, name FROM users WHERE tenant_id = ${tenantId} AND role = 'owner' LIMIT 1`);
      if (rows[0]?.email) {
        await sendSystemNotification({
          tenant_id: tenantId, type: 'fiscal_alert' as any,
          recipient: { email: rows[0].email, name: rows[0].name ?? '' },
          data: { title: c.title, severity: c.severity, rule: c.ruleKey },
        } as any).catch(() => { /* template pode não existir ainda — in-app cobre */ });
        await db.update(fiscalAlerts).set({ email_sent: true }).where(eq(fiscalAlerts.id, row.id));
      }
    }
    return 'raised';
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      await db.update(fiscalAlerts).set({ last_detected_at: new Date() })
        .where(and(eq(fiscalAlerts.tenant_id, tenantId), eq(fiscalAlerts.dedupe_key, dedupe),
          inArray(fiscalAlerts.status, ['open', 'acknowledged'])));
      return 'deduped';
    }
    throw err;
  }
}

export async function evaluateAndPersist(
  tenantId: string, companyId: string | null | undefined, db: DrizzleDB = _db,
): Promise<{ raised: number; deduped: number; autoResolved: number }> {
  const company = await resolveCompanyId(tenantId, companyId, db);
  const snapshot = await loadSnapshot(tenantId, company.id, db);

  const candidates: AlertCandidate[] = [
    ...evaluateAlertRules(snapshot),
    ...(await detectInconsistencies(tenantId, company.id, null, db)).map(mapFindingToCandidate),
  ];

  let raised = 0, deduped = 0;
  for (const c of candidates) {
    const r = await persistCandidate(tenantId, company.id, c, db);
    if (r === 'raised') raised++; else deduped++;
  }

  // AutoResolve: alerta aberto cuja dedupe_key não foi re-detectada nesta rodada.
  const activeKeys = new Set(candidates.map(buildDedupeKey));
  const open = await db.select({ id: fiscalAlerts.id, dedupe_key: fiscalAlerts.dedupe_key })
    .from(fiscalAlerts)
    .where(and(eq(fiscalAlerts.tenant_id, tenantId), eq(fiscalAlerts.company_id, company.id),
      inArray(fiscalAlerts.status, ['open', 'acknowledged'])));
  let autoResolved = 0;
  for (const a of open) {
    if (!activeKeys.has(a.dedupe_key)) {
      await db.update(fiscalAlerts)
        .set({ status: 'resolved', resolution: 'auto', resolved_at: new Date() })
        .where(eq(fiscalAlerts.id, a.id));
      autoResolved++;
    }
  }

  return { raised, deduped, autoResolved };
}

export async function listAlerts(
  tenantId: string, filters: { status?: string; severity?: string; limit?: number }, db: DrizzleDB = _db,
) {
  const conditions = [eq(fiscalAlerts.tenant_id, tenantId)];
  if (filters.status) conditions.push(inArray(fiscalAlerts.status, filters.status.split(',')));
  if (filters.severity) conditions.push(eq(fiscalAlerts.severity, filters.severity));
  return db.select().from(fiscalAlerts).where(and(...conditions))
    .orderBy(desc(fiscalAlerts.last_detected_at)).limit(filters.limit ?? 100);
}

export async function countOpenAlerts(tenantId: string, db: DrizzleDB = _db) {
  const { rows } = await db.execute<any>(sql`
    SELECT severity, COUNT(*) AS n FROM fiscal_alerts
    WHERE tenant_id = ${tenantId} AND status = 'open' GROUP BY severity`);
  const bySev = Object.fromEntries(rows.map((r: any) => [r.severity, Number(r.n)]));
  return { open: rows.reduce((s: number, r: any) => s + Number(r.n), 0), critical: bySev.critical ?? 0, warning: bySev.warning ?? 0 };
}

export async function setAlertStatus(
  tenantId: string, alertId: string, action: 'acknowledge' | 'resolve', userId: string, db: DrizzleDB = _db,
): Promise<FiscalAlert> {
  const [alert] = await db.select().from(fiscalAlerts)
    .where(and(eq(fiscalAlerts.id, alertId), eq(fiscalAlerts.tenant_id, tenantId)));
  if (!alert) throw new AlertError('alert_not_found');
  if (alert.status === 'resolved') throw new AlertError('alert_already_resolved');
  const patch = action === 'acknowledge'
    ? { status: 'acknowledged' as const, acknowledged_by: userId, acknowledged_at: new Date() }
    : { status: 'resolved' as const, resolved_by: userId, resolved_at: new Date(), resolution: 'manual' as const };
  const [updated] = await db.update(fiscalAlerts).set(patch).where(eq(fiscalAlerts.id, alertId)).returning();
  return updated;
}
