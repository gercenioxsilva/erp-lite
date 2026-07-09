// Application Service — Áreas de Atuação do agendamento.
// Soft-delete (is_active=false) é o caminho preferencial. Exclusão definitiva
// só passa se NENHUMA sessão referencia a área (FK RESTRICT ⇒ pg 23503, que
// vira o erro de domínio 'area_in_use' → 409 na rota); referências em modelos
// e pacotes são SET NULL e apenas perdem o vínculo, como manda o spec.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { schedulingAreas } from '../db/schema';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

export type DrizzleDB = typeof _db;

export interface ListAreasArgs {
  tenantId:         string;
  includeInactive?: boolean;
}

export async function listAreas(args: ListAreasArgs, db: DrizzleDB = _db) {
  const where = args.includeInactive
    ? eq(schedulingAreas.tenant_id, args.tenantId)
    : and(eq(schedulingAreas.tenant_id, args.tenantId), eq(schedulingAreas.is_active, true));
  const rows = await db.select().from(schedulingAreas).where(where);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAreaOrThrow(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [area] = await db.select().from(schedulingAreas)
    .where(and(eq(schedulingAreas.id, id), eq(schedulingAreas.tenant_id, tenantId)));
  if (!area) throw new SchedulingDomainError('area_not_found', { id });
  return area;
}

export interface CreateAreaArgs {
  tenantId:                string;
  name:                    string;
  description?:            string | null;
  defaultDurationMinutes:  number;
  defaultPrice?:           number;
  rulesText?:              string | null;
  createdBy?:              string | null;
}

export async function createArea(args: CreateAreaArgs, db: DrizzleDB = _db) {
  if (!args.name?.trim()) throw new SchedulingDomainError('area_name_required');
  if (!Number.isInteger(args.defaultDurationMinutes) || args.defaultDurationMinutes <= 0) {
    throw new SchedulingDomainError('invalid_duration', { value: args.defaultDurationMinutes });
  }

  const [area] = await db.insert(schedulingAreas).values({
    tenant_id:                args.tenantId,
    name:                     args.name.trim(),
    description:              args.description ?? null,
    default_duration_minutes: args.defaultDurationMinutes,
    default_price:            String(args.defaultPrice ?? 0),
    rules_text:               args.rulesText ?? null,
    created_by:               args.createdBy ?? null,
  }).returning();
  return area;
}

export interface UpdateAreaArgs {
  name?:                   string;
  description?:            string | null;
  defaultDurationMinutes?: number;
  defaultPrice?:           number;
  rulesText?:              string | null;
  isActive?:               boolean;
}

export async function updateArea(id: string, tenantId: string, args: UpdateAreaArgs, db: DrizzleDB = _db) {
  await getAreaOrThrow(id, tenantId, db);

  if (args.name !== undefined && !args.name.trim()) {
    throw new SchedulingDomainError('area_name_required');
  }
  if (args.defaultDurationMinutes !== undefined &&
      (!Number.isInteger(args.defaultDurationMinutes) || args.defaultDurationMinutes <= 0)) {
    throw new SchedulingDomainError('invalid_duration', { value: args.defaultDurationMinutes });
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name                   !== undefined) patch.name                     = args.name.trim();
  if (args.description            !== undefined) patch.description              = args.description;
  if (args.defaultDurationMinutes !== undefined) patch.default_duration_minutes = args.defaultDurationMinutes;
  if (args.defaultPrice           !== undefined) patch.default_price            = String(args.defaultPrice);
  if (args.rulesText              !== undefined) patch.rules_text               = args.rulesText;
  if (args.isActive               !== undefined) patch.is_active                = args.isActive;

  const [updated] = await db.update(schedulingAreas).set(patch)
    .where(eq(schedulingAreas.id, id)).returning();
  return updated;
}

/** Exclusão definitiva (com confirmação na UI). Sessões referenciando a área
 *  (RESTRICT) fazem o delete falhar ⇒ 'area_in_use' orienta a desativar. */
export async function deleteArea(id: string, tenantId: string, db: DrizzleDB = _db): Promise<void> {
  await getAreaOrThrow(id, tenantId, db);
  try {
    await db.delete(schedulingAreas)
      .where(and(eq(schedulingAreas.id, id), eq(schedulingAreas.tenant_id, tenantId)));
  } catch (err: any) {
    if (err.code === '23503') {
      throw new SchedulingDomainError('area_in_use', { id });
    }
    throw err;
  }
}
