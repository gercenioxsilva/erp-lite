// Robô de fechamento de competência (0077).
// closeCompetencia executa o checklist com isolamento por etapa; FECHAR ≠
// TRAVAR: a trava (lockCompetencia) é ação separada, só permitida quando os
// drafts da competência estão todos finalizados (emissão é assíncrona).
// assertCompetenciaAberta é o helper ÚNICO de enforcement, consumido por
// apuração, consolidação, conciliação manual, import e posting contábil;
// fatos sem company_id bloqueiam se QUALQUER company do tenant estiver
// travada na competência (decisão conservadora do plano).

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalClosingRuns, fiscalPeriodLocks, fiscalDocumentDrafts } from '../db/schema';
import { resolveCompanyId } from './companyService';
import { runReconciliation } from './reconciliationService';
import { consolidateMatched, calculateDraft, emitDraft, listDrafts } from './consolidationService';
import { apurarCompetencia } from './apuracaoService';
import { detectInconsistencies } from './fiscalInconsistencyService';
import { evaluateAndPersist } from './fiscalAlertService';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { validateCompetencia } from '../domain/fiscal/fiscalCompanyConfigDomain';
import { FiscalLockError, assertCompetenciaAberta } from './fiscalPeriodLockGuard';

export type DrizzleDB = typeof _db;
export type ClosingRun = typeof fiscalClosingRuns.$inferSelect;

export { FiscalLockError, assertCompetenciaAberta } from './fiscalPeriodLockGuard';

type StepStatus = 'ok' | 'warning' | 'error';
type Steps = Record<string, { status: StepStatus; detail: string; at: string }>;

/** Ciclo completo: cada etapa isolada — erro vira step 'error' e o run segue. */
export async function closeCompetencia(
  tenantId: string, companyId: string | null | undefined, competencia: string,
  actorUserId: string | null, db: DrizzleDB = _db,
): Promise<ClosingRun> {
  validateCompetencia(competencia);
  const company = await resolveCompanyId(tenantId, companyId, db);
  await assertCompetenciaAberta(tenantId, company.id, competencia, db);

  let run: ClosingRun;
  try {
    [run] = await db.insert(fiscalClosingRuns).values({
      tenant_id: tenantId, company_id: company.id, competencia, started_by: actorUserId,
    }).returning();
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new FiscalLockError('closing_already_running', { competencia });
    throw err;
  }

  const steps: Steps = {};
  const mark = (step: string, status: StepStatus, detail: string) => {
    steps[step] = { status, detail, at: new Date().toISOString() };
  };
  const exec = async (step: string, fn: () => Promise<string>) => {
    try { mark(step, 'ok', await fn()); }
    catch (err) {
      mark(step, 'error', err instanceof Error ? (err as any).code ?? err.message : String(err));
    }
  };

  await exec('reconcile', async () => {
    const r = await runReconciliation(tenantId, { companyId: company.id }, db);
    return `${r.autoConfirmed} auto-conciliadas, ${r.suggested} sugeridas, ${r.unmatched} pendentes`;
  });
  await exec('consolidate', async () => {
    const r = await consolidateMatched(tenantId, { companyId: company.id }, db);
    return `${r.attached} vendas em ${r.drafts} draft(s), ${r.skipped} puladas`;
  });

  // Emissão POR-DRAFT filtrada pela competência (nunca runScheduled cru).
  await exec('emit', async () => {
    const drafts = await listDrafts(tenantId, { competency: competencia }, db);
    let emitted = 0, waiting = 0, failed = 0;
    for (const d of drafts.filter((x) => ['open', 'sealed', 'calculated'].includes(x.status))) {
      try {
        if (d.status !== 'calculated') await calculateDraft(tenantId, d.id, actorUserId, db);
        await emitDraft(tenantId, d.id, actorUserId, db);
        emitted++;
      } catch (err) { failed++; }
    }
    waiting = (await listDrafts(tenantId, { competency: competencia }, db))
      .filter((x) => x.status === 'emitting').length;
    const detail = `${emitted} emitida(s), ${waiting} aguardando autorização, ${failed} falha(s)`;
    if (failed > 0) throw Object.assign(new Error(detail), { code: detail });
    if (waiting > 0) mark('emit', 'warning', detail);
    return detail;
  });

  await exec('apurar', async () => {
    const a = await apurarCompetencia(tenantId, company.id, competencia, actorUserId, db);
    return `DAS R$ ${a.das_total} (RBT12 R$ ${a.rbt12})`;
  });

  let findingsCount = 0;
  await exec('inconsistencias', async () => {
    const findings = await detectInconsistencies(tenantId, company.id, competencia, db);
    findingsCount = findings.length;
    const criticals = findings.filter((f) => f.severity === 'critical').length;
    const detail = `${findings.length} inconsistência(s), ${criticals} crítica(s)`;
    if (criticals > 0) mark('inconsistencias', 'warning', detail);
    return detail;
  });
  await exec('alertas', async () => {
    const r = await evaluateAndPersist(tenantId, company.id, db);
    return `${r.raised} alerta(s) novo(s), ${r.autoResolved} auto-resolvido(s)`;
  });

  const hasError = Object.values(steps).some((s) => s.status === 'error');
  const hasWarning = Object.values(steps).some((s) => s.status === 'warning');
  const status = hasError ? 'failed' : hasWarning ? 'completed_with_warnings' : 'completed';
  const report = { competencia, steps, findings: findingsCount, generated_at: new Date().toISOString() };

  const [finished] = await db.update(fiscalClosingRuns)
    .set({ status, steps, report, finished_at: new Date() })
    .where(eq(fiscalClosingRuns.id, run.id)).returning();

  await recordFiscalEvent({
    tenantId, companyId: company.id, aggregateType: 'closing', aggregateId: run.id,
    eventType: 'closing_finished', actorUserId, responsePayload: { status, competencia },
    idempotencyKey: `closing:${run.id}`,
  }, db);

  return finished;
}

/** TRAVA (estágio separado): recusa com draft ainda em emissão. */
export async function lockCompetencia(
  tenantId: string, companyId: string | null | undefined, competencia: string,
  actorUserId: string, db: DrizzleDB = _db,
): Promise<void> {
  validateCompetencia(competencia);
  const company = await resolveCompanyId(tenantId, companyId, db);

  const pendentes = await db.select({ id: fiscalDocumentDrafts.id }).from(fiscalDocumentDrafts)
    .where(and(
      eq(fiscalDocumentDrafts.tenant_id, tenantId),
      eq(fiscalDocumentDrafts.company_id, company.id),
      eq(fiscalDocumentDrafts.competency_ref, competencia),
      inArray(fiscalDocumentDrafts.status, ['open', 'sealed', 'calculated', 'emitting']),
    ));
  if (pendentes.length > 0) {
    throw new FiscalLockError('drafts_pendentes', { count: pendentes.length,
      hint: 'Aguarde a autorização das NFS-e (ou cancele os drafts) antes de travar.' });
  }

  const [lastRun] = await db.select({ id: fiscalClosingRuns.id, report: fiscalClosingRuns.report })
    .from(fiscalClosingRuns)
    .where(and(eq(fiscalClosingRuns.tenant_id, tenantId), eq(fiscalClosingRuns.company_id, company.id),
      eq(fiscalClosingRuns.competencia, competencia)))
    .orderBy(sql`started_at DESC`).limit(1);

  const values = {
    tenant_id: tenantId, company_id: company.id, competencia,
    status: 'locked' as const, closing_run_id: lastRun?.id ?? null,
    report: lastRun?.report ?? null, locked_by: actorUserId, locked_at: new Date(),
    unlocked_by: null, unlocked_at: null, unlock_reason: null,
  };
  try {
    await db.insert(fiscalPeriodLocks).values(values);
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;
    await db.update(fiscalPeriodLocks).set(values)
      .where(and(eq(fiscalPeriodLocks.tenant_id, tenantId), eq(fiscalPeriodLocks.company_id, company.id),
        eq(fiscalPeriodLocks.competencia, competencia)));
  }
  await recordFiscalEvent({
    tenantId, companyId: company.id, aggregateType: 'period_lock', aggregateId: null,
    eventType: 'period_locked', actorUserId, requestPayload: { competencia },
  }, db);
}

/** Reabrir exige reason; força reapuração para lock e apuração não divergirem. */
export async function unlockCompetencia(
  tenantId: string, companyId: string | null | undefined, competencia: string,
  reason: string, actorUserId: string, db: DrizzleDB = _db,
): Promise<void> {
  const company = await resolveCompanyId(tenantId, companyId, db);
  const [lock] = await db.update(fiscalPeriodLocks)
    .set({ status: 'unlocked', unlocked_by: actorUserId, unlocked_at: new Date(), unlock_reason: reason })
    .where(and(eq(fiscalPeriodLocks.tenant_id, tenantId), eq(fiscalPeriodLocks.company_id, company.id),
      eq(fiscalPeriodLocks.competencia, competencia), eq(fiscalPeriodLocks.status, 'locked')))
    .returning();
  if (!lock) throw new FiscalLockError('lock_not_found', { competencia });

  await recordFiscalEvent({
    tenantId, companyId: company.id, aggregateType: 'period_lock', aggregateId: lock.id,
    eventType: 'period_unlocked', actorUserId, requestPayload: { competencia, reason },
  }, db);
  // Reapuração forçada — reabrir sem reapurar deixaria lock/apuração inconsistentes.
  try { await apurarCompetencia(tenantId, company.id, competencia, actorUserId, db); }
  catch { /* sem receita/config: apuração indisponível, o evento acima registra a reabertura */ }
}

export async function getClosingStatus(tenantId: string, companyId: string | null | undefined, competencia: string, db: DrizzleDB = _db) {
  const company = await resolveCompanyId(tenantId, companyId, db);
  const [run] = await db.select().from(fiscalClosingRuns)
    .where(and(eq(fiscalClosingRuns.tenant_id, tenantId), eq(fiscalClosingRuns.company_id, company.id),
      eq(fiscalClosingRuns.competencia, competencia)))
    .orderBy(sql`started_at DESC`).limit(1);
  const [lock] = await db.select().from(fiscalPeriodLocks)
    .where(and(eq(fiscalPeriodLocks.tenant_id, tenantId), eq(fiscalPeriodLocks.company_id, company.id),
      eq(fiscalPeriodLocks.competencia, competencia)));
  return { run: run ?? null, lock: lock ?? null };
}

export async function listLocks(tenantId: string, db: DrizzleDB = _db) {
  return db.select().from(fiscalPeriodLocks)
    .where(and(eq(fiscalPeriodLocks.tenant_id, tenantId), eq(fiscalPeriodLocks.status, 'locked')));
}
