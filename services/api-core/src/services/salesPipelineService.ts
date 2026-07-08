// Application Service — Funil de Vendas / CRM (módulo opcional).
// Orquestra I/O + transação: etapas configuráveis por tenant, oportunidades,
// timeline de atividades (com log automático de mudança de etapa/resultado),
// e conversão em Proposta reaproveitando 100% do que já existe em `proposals`
// — nunca duplica o ciclo de vida de proposta, só cria o rascunho inicial.

import { sql, eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  salesPipelineStages, salesOpportunities, salesOpportunityActivities,
  proposals, proposalItems,
} from '../db/schema';
import {
  assertCanMarkWon, assertCanMarkLost, validateOpportunityValue, validateOpportunityTitle,
  DEFAULT_STAGES, isManualActivityType, SalesPipelineDomainError,
  type OpportunityStatus, type ActivityType,
} from '../domain/salesPipeline/salesPipelineDomain';

export type DrizzleDB = typeof _db;
export { SalesPipelineDomainError };

// ── Etapas ─────────────────────────────────────────────────────────────────────

/** Etapas ativas do tenant, ordenadas — semeia as etapas padrão na primeira
 * leitura se o tenant ainda não tem nenhuma (idempotente, sem depender de um
 * hook especial no tenantModuleService.ts genérico). */
export async function listStages(tenantId: string, db: DrizzleDB = _db) {
  const existing = await db.select().from(salesPipelineStages)
    .where(eq(salesPipelineStages.tenant_id, tenantId));

  if (existing.length === 0) {
    const seeded = await db.transaction(async (tx) => {
      const rows = [];
      for (let i = 0; i < DEFAULT_STAGES.length; i++) {
        const [row] = await tx.insert(salesPipelineStages).values({
          tenant_id: tenantId, name: DEFAULT_STAGES[i], sort_order: i,
        }).returning();
        rows.push(row);
      }
      return rows;
    });
    return seeded;
  }

  return existing
    .filter(s => s.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export interface CreateStageArgs { tenantId: string; name: string; }

export async function createStage(args: CreateStageArgs, db: DrizzleDB = _db) {
  if (!args.name?.trim()) throw new SalesPipelineDomainError('stage_name_required');

  const [{ maxOrder }] = await db.select({
    maxOrder: sql<number>`COALESCE(MAX(${salesPipelineStages.sort_order}), -1)`,
  }).from(salesPipelineStages).where(eq(salesPipelineStages.tenant_id, args.tenantId));

  const [stage] = await db.insert(salesPipelineStages).values({
    tenant_id: args.tenantId, name: args.name.trim(), sort_order: Number(maxOrder) + 1,
  }).returning();
  return stage;
}

export interface UpdateStageArgs { name?: string; sort_order?: number; is_active?: boolean; }

export async function updateStage(id: string, tenantId: string, args: UpdateStageArgs, db: DrizzleDB = _db) {
  const [stage] = await db.select().from(salesPipelineStages)
    .where(and(eq(salesPipelineStages.id, id), eq(salesPipelineStages.tenant_id, tenantId)));
  if (!stage) throw new SalesPipelineDomainError('stage_not_found', { id });

  if (args.name !== undefined && !args.name.trim()) {
    throw new SalesPipelineDomainError('stage_name_required');
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name       !== undefined) patch.name       = args.name.trim();
  if (args.sort_order !== undefined) patch.sort_order = args.sort_order;
  if (args.is_active  !== undefined) patch.is_active  = args.is_active;

  const [updated] = await db.update(salesPipelineStages).set(patch)
    .where(eq(salesPipelineStages.id, id)).returning();
  return updated;
}

// ── Oportunidades ──────────────────────────────────────────────────────────────

export interface CreateOpportunityArgs {
  tenantId:    string;
  stageId:     string;
  title:       string;
  clientId?:   string | null;
  sellerId?:   string | null;
  contactName?:  string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  value?:      number;
  source?:     string | null;
  expectedCloseDate?: string | null;
  notes?:      string | null;
  createdBy?:  string | null;
}

async function assertStageBelongsToTenant(stageId: string, tenantId: string, db: DrizzleDB) {
  const [stage] = await db.select().from(salesPipelineStages)
    .where(and(eq(salesPipelineStages.id, stageId), eq(salesPipelineStages.tenant_id, tenantId)));
  if (!stage) throw new SalesPipelineDomainError('stage_not_found', { id: stageId });
  return stage;
}

export async function createOpportunity(args: CreateOpportunityArgs, db: DrizzleDB = _db) {
  validateOpportunityTitle(args.title);
  const value = args.value ?? 0;
  validateOpportunityValue(value);
  await assertStageBelongsToTenant(args.stageId, args.tenantId, db);

  const [opportunity] = await db.insert(salesOpportunities).values({
    tenant_id:   args.tenantId,
    stage_id:    args.stageId,
    client_id:   args.clientId   || null,
    seller_id:   args.sellerId   || null,
    title:       args.title.trim(),
    contact_name:  args.contactName  || null,
    contact_email: args.contactEmail || null,
    contact_phone: args.contactPhone || null,
    value:       String(value),
    source:      args.source || null,
    expected_close_date: args.expectedCloseDate || null,
    notes:       args.notes || null,
    created_by:  args.createdBy || null,
  }).returning();

  return opportunity;
}

export interface UpdateOpportunityArgs {
  title?: string; clientId?: string | null; sellerId?: string | null;
  contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  value?: number; source?: string | null; expectedCloseDate?: string | null; notes?: string | null;
}

async function getOpportunityOrThrow(id: string, tenantId: string, db: DrizzleDB) {
  const [opp] = await db.select().from(salesOpportunities)
    .where(and(eq(salesOpportunities.id, id), eq(salesOpportunities.tenant_id, tenantId)));
  if (!opp) throw new SalesPipelineDomainError('opportunity_not_found', { id });
  return opp;
}

export async function updateOpportunity(
  id: string, tenantId: string, args: UpdateOpportunityArgs, db: DrizzleDB = _db,
) {
  await getOpportunityOrThrow(id, tenantId, db);

  if (args.title !== undefined) validateOpportunityTitle(args.title);
  if (args.value !== undefined) validateOpportunityValue(args.value);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.title             !== undefined) patch.title             = args.title.trim();
  if (args.clientId          !== undefined) patch.client_id         = args.clientId || null;
  if (args.sellerId          !== undefined) patch.seller_id         = args.sellerId || null;
  if (args.contactName       !== undefined) patch.contact_name      = args.contactName  || null;
  if (args.contactEmail      !== undefined) patch.contact_email     = args.contactEmail || null;
  if (args.contactPhone      !== undefined) patch.contact_phone     = args.contactPhone || null;
  if (args.value             !== undefined) patch.value             = String(args.value);
  if (args.source            !== undefined) patch.source            = args.source || null;
  if (args.expectedCloseDate !== undefined) patch.expected_close_date = args.expectedCloseDate || null;
  if (args.notes             !== undefined) patch.notes             = args.notes || null;

  const [updated] = await db.update(salesOpportunities).set(patch)
    .where(eq(salesOpportunities.id, id)).returning();
  return updated;
}

/** Move a oportunidade de etapa — loga a transição automaticamente na
 * timeline (nunca manual, para o histórico ser sempre confiável). */
export async function moveStage(
  id: string, tenantId: string, newStageId: string, userId: string | null, db: DrizzleDB = _db,
) {
  const opp   = await getOpportunityOrThrow(id, tenantId, db);
  const stage = await assertStageBelongsToTenant(newStageId, tenantId, db);
  if (opp.stage_id === newStageId) return opp;

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(salesOpportunities)
      .set({ stage_id: newStageId, updated_at: new Date() })
      .where(eq(salesOpportunities.id, id)).returning();

    await tx.insert(salesOpportunityActivities).values({
      tenant_id: tenantId, opportunity_id: id, type: 'stage_change',
      description: `Movida para "${stage.name}"`, created_by: userId,
    });

    return updated;
  });
}

async function closeOpportunity(
  id: string, tenantId: string, outcome: 'won' | 'lost',
  extra: { lostReason?: string | null }, userId: string | null, db: DrizzleDB,
) {
  const opp = await getOpportunityOrThrow(id, tenantId, db);
  const status = opp.status as OpportunityStatus;
  if (outcome === 'won') assertCanMarkWon(status);
  else assertCanMarkLost(status);

  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx.update(salesOpportunities).set({
      status: outcome,
      won_at:  outcome === 'won'  ? now : null,
      lost_at: outcome === 'lost' ? now : null,
      lost_reason: outcome === 'lost' ? (extra.lostReason || null) : null,
      updated_at: now,
    }).where(eq(salesOpportunities.id, id)).returning();

    await tx.insert(salesOpportunityActivities).values({
      tenant_id: tenantId, opportunity_id: id, type: outcome,
      description: outcome === 'lost' ? (extra.lostReason || null) : null,
      created_by: userId,
    });

    return updated;
  });
}

export async function markWon(id: string, tenantId: string, userId: string | null, db: DrizzleDB = _db) {
  return closeOpportunity(id, tenantId, 'won', {}, userId, db);
}

export async function markLost(
  id: string, tenantId: string, lostReason: string | null, userId: string | null, db: DrizzleDB = _db,
) {
  return closeOpportunity(id, tenantId, 'lost', { lostReason }, userId, db);
}

// ── Atividades (timeline) ──────────────────────────────────────────────────────

export async function listActivities(opportunityId: string, tenantId: string, db: DrizzleDB = _db) {
  await getOpportunityOrThrow(opportunityId, tenantId, db);
  return db.select().from(salesOpportunityActivities)
    .where(and(
      eq(salesOpportunityActivities.opportunity_id, opportunityId),
      eq(salesOpportunityActivities.tenant_id, tenantId),
    ))
    .orderBy(sql`${salesOpportunityActivities.created_at} DESC`);
}

export interface LogActivityArgs {
  opportunityId: string; tenantId: string; type: ActivityType;
  description?: string | null; userId?: string | null;
}

/** Só os tipos manuais (note/call/meeting) podem ser logados por aqui —
 * stage_change/won/lost/proposal_linked são sempre automáticos, disparados
 * pelas próprias operações que os causam (nunca digitados à mão). */
export async function logActivity(args: LogActivityArgs, db: DrizzleDB = _db) {
  await getOpportunityOrThrow(args.opportunityId, args.tenantId, db);
  if (!isManualActivityType(args.type)) {
    throw new SalesPipelineDomainError('activity_type_not_manual', { type: args.type });
  }

  const [activity] = await db.insert(salesOpportunityActivities).values({
    tenant_id: args.tenantId, opportunity_id: args.opportunityId, type: args.type,
    description: args.description || null, created_by: args.userId || null,
  }).returning();
  return activity;
}

// ── Conversão em Proposta ──────────────────────────────────────────────────────
// Reaproveita o schema de `proposals`/`proposal_items` tal como está — cria só
// um rascunho com 1 item-placeholder (nome = título da oportunidade, valor =
// valor estimado), pois toda proposta exige ao menos um item (regra já
// existente em POST /v1/proposals). O usuário refina os itens de verdade
// depois, dentro do fluxo de Propostas que já existe — zero duplicação.

export async function convertToProposal(
  id: string, tenantId: string, userId: string | null, userEmail: string | null, db: DrizzleDB = _db,
) {
  const opp = await getOpportunityOrThrow(id, tenantId, db);
  if (opp.proposal_id) throw new SalesPipelineDomainError('opportunity_already_converted', { proposalId: opp.proposal_id });

  const value = Number(opp.value);

  return db.transaction(async (tx) => {
    const { rows: [{ max_number }] } = await tx.execute<{ max_number: string }>(sql`
      SELECT COALESCE(MAX(CAST(number AS INTEGER)), 0) AS max_number FROM proposals WHERE tenant_id = ${tenantId}
    `);
    const number = String((Number(max_number) || 0) + 1).padStart(5, '0');

    const [proposal] = await tx.insert(proposals).values({
      tenant_id: tenantId, client_id: opp.client_id, number, title: opp.title,
      status: 'draft', subtotal: String(value), total: String(value),
      notes: opp.notes, seller_email: userEmail, created_by: userId,
    }).returning();

    await tx.insert(proposalItems).values({
      proposal_id: proposal.id, name: opp.title, unit: 'UN',
      quantity: '1', unit_price: String(value), total: String(value), sort_order: 0,
    });

    const [updatedOpp] = await tx.update(salesOpportunities)
      .set({ proposal_id: proposal.id, updated_at: new Date() })
      .where(eq(salesOpportunities.id, id)).returning();

    await tx.insert(salesOpportunityActivities).values({
      tenant_id: tenantId, opportunity_id: id, type: 'proposal_linked',
      description: `Proposta #${number} criada`, created_by: userId,
    });

    return { opportunity: updatedOpp, proposal };
  });
}

// ── Listagem (Kanban) ──────────────────────────────────────────────────────────

export interface ListOpportunitiesArgs { tenantId: string; sellerId?: string; status?: OpportunityStatus; }

export async function listOpportunities(args: ListOpportunitiesArgs, db: DrizzleDB = _db) {
  const conditions = [eq(salesOpportunities.tenant_id, args.tenantId)];
  if (args.sellerId) conditions.push(eq(salesOpportunities.seller_id, args.sellerId));
  if (args.status)   conditions.push(eq(salesOpportunities.status, args.status));

  return db.select().from(salesOpportunities).where(and(...conditions))
    .orderBy(sql`${salesOpportunities.created_at} DESC`);
}
