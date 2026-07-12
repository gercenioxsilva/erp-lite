// Consolidação (0073) — camada de serviço.
// consolidateMatched: transações conciliadas → drafts (attach idempotente por
// UNIQUE tenant+transaction; draft por UNIQUE tenant+grouping_key).
// calculateDraft: snapshot tributário (RBT12 + efetiva via getSimplesEffectiveRate;
// MEI bloqueado; ISS informativo p/ Simples — nunca recolhimento avulso).
// emitDraft: gate VALIDAR (getEmissionReadiness) → materializa nfse_invoices →
// enfileira (mesmo transporte type:'nfse' do lambda-fiscal) com trava
// draft.nfse_id + UPDATE ... WHERE status RETURNING (idempotência de emissão).
// runScheduled: alvo do EventBridge 23:59 — isolamento POR DRAFT (erro em 1
// nota nunca interrompe as outras).

import { eq, and, sql } from 'drizzle-orm';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { db as _db } from '../db';
import {
  importedTransactions, fiscalDocumentDrafts, fiscalDocumentDraftLines,
  fiscalDocumentDraftEvents, consolidationRules, nfseInvoices, nfeConfigs, clients,
} from '../db/schema';
import { getSqsClient } from '../lib/sqsClient';
import { buildNfseEmitMessage } from '../lib/nfse';
import { getSimplesEffectiveRate } from '../lib/taxRulesResolver';
import { getOrCreateConfig, getEmissionReadiness, listServiceCodes } from './fiscalCompanyConfigService';
import { enqueueAbrasfEmission } from './nfseProviderService';
import { assertCompetenciaAberta } from './fiscalPeriodLockGuard';
import { record as recordFiscalEvent } from './fiscalAuditService';
import { isUniqueConstraintViolation } from '../lib/pgErrors';
import { toNumber, toDecimalString, round2 } from '../lib/money';
import { assertApuravelPorPercentual } from '../domain/simples/simplesDomain';
import { resolveRbt12 } from './fiscalRevenueService';
import {
  computeGroupingKey, resolveRule, competencyOf, Strategy, STRATEGIES,
  ConsolidationDomainError, RuleForResolution,
} from '../domain/consolidation/consolidationDomain';

export type DrizzleDB = typeof _db;
export type Draft = typeof fiscalDocumentDrafts.$inferSelect;

async function draftEvent(draftId: string, tenantId: string, eventType: string, payload: unknown, createdBy: string | null, db: DrizzleDB) {
  await db.insert(fiscalDocumentDraftEvents).values({
    tenant_id: tenantId, draft_id: draftId, event_type: eventType,
    payload: payload ?? null, created_by: createdBy,
  });
}

async function loadRules(tenantId: string, db: DrizzleDB): Promise<RuleForResolution[]> {
  const rows = await db.select().from(consolidationRules)
    .where(and(eq(consolidationRules.tenant_id, tenantId), eq(consolidationRules.is_active, true)));
  return rows.map((r) => ({
    id: r.id, companyId: r.company_id, clientId: r.client_id, contractId: r.contract_id,
    strategy: r.strategy as Strategy, serviceCode: r.service_code,
  }));
}

async function defaultServiceCode(tenantId: string, companyId: string, db: DrizzleDB): Promise<string | null> {
  const codes = await listServiceCodes(tenantId, companyId, db);
  const def = codes.find((c) => c.is_default) ?? codes[0];
  if (def) return def.codigo_lc116;
  const [company] = await db.select({ codigo: nfeConfigs.codigo_servico_padrao })
    .from(nfeConfigs).where(eq(nfeConfigs.id, companyId));
  return company?.codigo ?? null;
}

export interface ConsolidateResult { attached: number; duplicates: number; skipped: number; drafts: number }

/** Agrupa transações conciliadas ainda sem draft. Idempotente ponta-a-ponta. */
export async function consolidateMatched(
  tenantId: string, opts: { companyId?: string } = {}, db: DrizzleDB = _db,
): Promise<ConsolidateResult> {
  const conditions = [
    eq(importedTransactions.tenant_id, tenantId),
    eq(importedTransactions.reconciliation_status, 'matched'),
  ];
  if (opts.companyId) conditions.push(eq(importedTransactions.company_id, opts.companyId));
  const txs = await db.select().from(importedTransactions).where(and(...conditions)).limit(1000);
  if (txs.length === 0) return { attached: 0, duplicates: 0, skipped: 0, drafts: 0 };

  const rules = await loadRules(tenantId, db);
  const serviceCodeCache = new Map<string, string | null>();
  const draftIds = new Set<string>();
  let attached = 0, duplicates = 0, skipped = 0;

  for (const tx of txs) {
    const rule = resolveRule(rules, { companyId: tx.company_id, clientId: null, contractId: null });
    const strategy: Strategy = rule?.strategy ?? 'monthly';

    if (!serviceCodeCache.has(tx.company_id)) {
      serviceCodeCache.set(tx.company_id, rule?.serviceCode ?? await defaultServiceCode(tenantId, tx.company_id, db));
    }
    const serviceCode = rule?.serviceCode ?? serviceCodeCache.get(tx.company_id);
    if (!serviceCode) { skipped++; continue; } // sem código de serviço não há como emitir — fica p/ o cadastro resolver

    const saleDate = tx.occurred_at ?? tx.created_at;
    const amount = toNumber(tx.gross_amount ?? tx.amount ?? tx.net_amount);
    if (amount <= 0) { skipped++; continue; }

    const groupingKey = computeGroupingKey(strategy, {
      transactionId: tx.id, companyId: tx.company_id, clientId: null, contractId: null,
      saleDate, serviceCode,
    });

    // get-or-create do draft pela grouping_key (corrida resolvida por 23505).
    let [draft] = await db.select().from(fiscalDocumentDrafts)
      .where(and(eq(fiscalDocumentDrafts.tenant_id, tenantId), eq(fiscalDocumentDrafts.grouping_key, groupingKey)));
    if (!draft) {
      try {
        [draft] = await db.insert(fiscalDocumentDrafts).values({
          tenant_id: tenantId, company_id: tx.company_id, rule_id: rule?.id ?? null,
          strategy_snapshot: strategy, competency_ref: competencyOf(saleDate),
          service_code: serviceCode, grouping_key: groupingKey,
        }).returning();
        await draftEvent(draft.id, tenantId, 'draft_created', { strategy, grouping_key: groupingKey }, null, db);
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        [draft] = await db.select().from(fiscalDocumentDrafts)
          .where(and(eq(fiscalDocumentDrafts.tenant_id, tenantId), eq(fiscalDocumentDrafts.grouping_key, groupingKey)));
      }
    }
    if (draft.status !== 'open') { skipped++; continue; } // selado/emitido: venda tardia fica p/ draft de ajuste (fase futura)

    try {
      await db.insert(fiscalDocumentDraftLines).values({
        tenant_id: tenantId, draft_id: draft.id, transaction_id: tx.id,
        service_code: serviceCode, amount: toDecimalString(amount),
        sale_date: saleDate.toISOString().slice(0, 10),
      });
      await db.update(fiscalDocumentDrafts)
        .set({ amount: sql`amount + ${toDecimalString(amount)}`, updated_at: new Date() })
        .where(eq(fiscalDocumentDrafts.id, draft.id));
      attached++;
      draftIds.add(draft.id);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) duplicates++; // transação já em outro draft
      else throw err;
    }
  }

  return { attached, duplicates, skipped, drafts: draftIds.size };
}

/** Snapshot tributário do draft (memória de cálculo). */
export async function calculateDraft(tenantId: string, draftId: string, actorUserId: string | null, db: DrizzleDB = _db): Promise<Draft> {
  const [draft] = await db.select().from(fiscalDocumentDrafts)
    .where(and(eq(fiscalDocumentDrafts.id, draftId), eq(fiscalDocumentDrafts.tenant_id, tenantId)));
  if (!draft) throw new ConsolidationDomainError('draft_not_found', { draftId });
  await assertCompetenciaAberta(tenantId, draft.company_id, draft.competency_ref, db);
  if (!['open', 'sealed', 'calculated'].includes(draft.status)) {
    throw new ConsolidationDomainError('draft_not_calculable', { status: draft.status });
  }

  const config = await getOrCreateConfig(tenantId, draft.company_id, db);
  assertApuravelPorPercentual(config.enquadramento); // MEI bloqueado

  // RBT12: fonte única compartilhada com a apuração (ledger com
  // proporcionalização de início de atividade / bootstrap manual).
  const { rbt12 } = await resolveRbt12(tenantId, draft.company_id, draft.competency_ref, config, db);

  const anexo = draft.anexo ?? (config.anexo_padrao ? ['I', 'II', 'III', 'IV', 'V'][config.anexo_padrao - 1] : 'III');
  const effective = await getSimplesEffectiveRate(rbt12, db as any, anexo, Number(draft.competency_ref.slice(0, 4)));

  // ISS informativo (dentro do DAS p/ optante); retido segue o default do cadastro.
  const [company] = await db.select({ aliquota_iss: nfeConfigs.aliquota_iss_padrao })
    .from(nfeConfigs).where(eq(nfeConfigs.id, draft.company_id));
  const issRate = toNumber(company?.aliquota_iss);
  const issValue = round2(toNumber(draft.amount) * issRate / 100);

  const [updated] = await db.update(fiscalDocumentDrafts).set({
    status: 'calculated', rbt12: toDecimalString(rbt12), anexo,
    simples_effective_rate: String(effective.toFixed(4)),
    iss_rate: String(issRate.toFixed(2)), iss_value: toDecimalString(issValue),
    iss_retido: config.iss_retido_padrao, updated_at: new Date(),
  }).where(eq(fiscalDocumentDrafts.id, draft.id)).returning();

  await draftEvent(draft.id, tenantId, 'draft_calculated',
    { rbt12, anexo, effective, iss_rate: issRate, iss_value: issValue }, actorUserId, db);
  return updated;
}

/** Gate VALIDAR + materialização + enfileiramento. Idempotente por nfse_id + status-guard. */
export async function emitDraft(tenantId: string, draftId: string, actorUserId: string | null, db: DrizzleDB = _db) {
  const [draft] = await db.select().from(fiscalDocumentDrafts)
    .where(and(eq(fiscalDocumentDrafts.id, draftId), eq(fiscalDocumentDrafts.tenant_id, tenantId)));
  if (!draft) throw new ConsolidationDomainError('draft_not_found', { draftId });
  await assertCompetenciaAberta(tenantId, draft.company_id, draft.competency_ref, db);
  if (draft.nfse_id) throw new ConsolidationDomainError('draft_already_emitted', { nfse_id: draft.nfse_id });
  if (draft.status !== 'calculated') throw new ConsolidationDomainError('draft_not_calculated', { status: draft.status });

  const readiness = await getEmissionReadiness(tenantId, draft.company_id, db);
  if (!readiness.ready) throw new ConsolidationDomainError('emission_not_ready', { reasons: readiness.reasons });

  // Trava de dupla emissão: só quem flipa calculated→emitting materializa.
  const [claimed] = await db.update(fiscalDocumentDrafts).set({ status: 'emitting', updated_at: new Date() })
    .where(and(eq(fiscalDocumentDrafts.id, draft.id), eq(fiscalDocumentDrafts.status, 'calculated')))
    .returning();
  if (!claimed) throw new ConsolidationDomainError('draft_already_emitting');

  const description = `Serviços consolidados ${draft.competency_ref} (${draft.strategy_snapshot})`;
  const [nfse] = await db.insert(nfseInvoices).values({
    tenant_id: tenantId, company_id: draft.company_id, client_id: draft.client_id,
    description, amount: draft.amount,
    iss_rate: draft.iss_rate ?? '0', iss_value: draft.iss_value ?? '0',
    service_code: draft.service_code ?? '',
    nfse_status: null,
  }).returning();

  await db.update(fiscalDocumentDrafts).set({ nfse_id: nfse.id }).where(eq(fiscalDocumentDrafts.id, draft.id));

  // Provider próprio (ABRASF): monta+assina no api-core e enfileira com o
  // XML pronto — o lambda só transporta. Focus permanece o fallback.
  const fiscalConfig = await getOrCreateConfig(tenantId, draft.company_id, db);
  if (fiscalConfig.nfse_provider === 'abrasf') {
    const { enqueued, simulated } = await enqueueAbrasfEmission(tenantId, nfse.id, db);
    await db.update(fiscalDocumentDrafts)
      .set({ status: enqueued ? 'emitting' : 'emitted', updated_at: new Date() })
      .where(eq(fiscalDocumentDrafts.id, draft.id));
    await draftEvent(draft.id, tenantId, 'emission_requested', { nfse_id: nfse.id, enqueued, provider: 'abrasf', simulated }, actorUserId, db);
    await recordFiscalEvent({
      tenantId, companyId: draft.company_id, aggregateType: 'draft', aggregateId: draft.id,
      eventType: 'emission_requested',
      requestPayload: { nfse_id: nfse.id, provider: 'abrasf' },
      idempotencyKey: `draft_emit:${draft.id}`,
    }, db);
    return { draft_id: draft.id, nfse_id: nfse.id, enqueued };
  }

  // Transporte existente: NFE_REQUESTS + type:'nfse' (+action p/ o motor 0074).
  const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
  let enqueued = false;
  if (queueUrl) {
    const [cfg] = await db.select().from(nfeConfigs).where(eq(nfeConfigs.id, draft.company_id));
    const [client] = draft.client_id
      ? await db.select().from(clients).where(eq(clients.id, draft.client_id))
      : [null];
    const message = buildNfseEmitMessage({
      nfseId: nfse.id, tenantId, description, amount: toNumber(draft.amount),
      issRate: toNumber(draft.iss_rate), issValue: toNumber(draft.iss_value),
      serviceCode: draft.service_code ?? '', cfg: cfg as any, client: (client ?? {}) as any,
    } as any);
    await db.update(nfseInvoices)
      .set({ nfse_status: 'pending', nfse_attempts: sql`nfse_attempts + 1` })
      .where(eq(nfseInvoices.id, nfse.id));
    await getSqsClient().send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ ...message, action: 'emit' }),
    }));
    await db.update(nfseInvoices).set({ nfse_status: 'processing' }).where(eq(nfseInvoices.id, nfse.id));
    enqueued = true;
  }

  await db.update(fiscalDocumentDrafts)
    .set({ status: enqueued ? 'emitting' : 'emitted', updated_at: new Date() })
    .where(eq(fiscalDocumentDrafts.id, draft.id));

  await draftEvent(draft.id, tenantId, 'emission_requested', { nfse_id: nfse.id, enqueued }, actorUserId, db);
  await recordFiscalEvent({
    tenantId, companyId: draft.company_id, aggregateType: 'draft', aggregateId: draft.id,
    eventType: 'emission_requested', actorUserId,
    requestPayload: { nfse_id: nfse.id, amount: draft.amount, competency: draft.competency_ref },
    idempotencyKey: `draft_emit:${draft.id}`,
  }, db);

  return { draft_id: draft.id, nfse_id: nfse.id, enqueued };
}

/** Ciclo agendado (EventBridge 23:59): consolida → calcula → valida → emite,
 *  com isolamento POR DRAFT — erro em 1 nota não interrompe as outras. */
export async function runScheduled(tenantId: string, db: DrizzleDB = _db) {
  const consolidated = await consolidateMatched(tenantId, {}, db);
  const drafts = await db.select().from(fiscalDocumentDrafts)
    .where(and(eq(fiscalDocumentDrafts.tenant_id, tenantId), eq(fiscalDocumentDrafts.status, 'open')));

  let emitted = 0, failed = 0;
  const errors: Array<{ draft_id: string; error: string }> = [];
  for (const d of drafts) {
    try {
      await calculateDraft(tenantId, d.id, null, db);
      await emitDraft(tenantId, d.id, null, db);
      emitted++;
    } catch (err) {
      failed++;
      const message = err instanceof ConsolidationDomainError ? err.code : (err instanceof Error ? err.message : String(err));
      errors.push({ draft_id: d.id, error: message });
      await db.update(fiscalDocumentDrafts)
        .set({ error_message: message, updated_at: new Date() })
        .where(eq(fiscalDocumentDrafts.id, d.id));
      await draftEvent(d.id, tenantId, 'emission_failed', { error: message, at: new Date().toISOString() }, null, db);
    }
  }
  return { ...consolidated, emitted, failed, errors };
}

export async function listDrafts(tenantId: string, filters: { status?: string; competency?: string }, db: DrizzleDB = _db) {
  const conditions = [eq(fiscalDocumentDrafts.tenant_id, tenantId)];
  if (filters.status) conditions.push(eq(fiscalDocumentDrafts.status, filters.status));
  if (filters.competency) conditions.push(eq(fiscalDocumentDrafts.competency_ref, filters.competency));
  return db.select().from(fiscalDocumentDrafts).where(and(...conditions)).limit(200);
}

export async function getDraft(tenantId: string, id: string, db: DrizzleDB = _db) {
  const [draft] = await db.select().from(fiscalDocumentDrafts)
    .where(and(eq(fiscalDocumentDrafts.id, id), eq(fiscalDocumentDrafts.tenant_id, tenantId)));
  if (!draft) throw new ConsolidationDomainError('draft_not_found', { id });
  const lines = await db.select().from(fiscalDocumentDraftLines).where(eq(fiscalDocumentDraftLines.draft_id, id));
  const events = await db.select().from(fiscalDocumentDraftEvents).where(eq(fiscalDocumentDraftEvents.draft_id, id));
  return { ...draft, lines, events };
}

export { STRATEGIES };
