// Application Service — Modelos de pacote e Pacotes do Cliente.
//
// Pacote do cliente é HISTÓRICO FINANCEIRO: nunca deletado (não existe função
// de delete), nome/área/preço são SNAPSHOT do modelo no momento da concessão.
// Saldo é derivado (remaining_sessions vai calculado nas respostas, nunca
// persistido). payment_status é manual (pending|partial|paid) — a cobrança é
// combinada fora do sistema. O débito de saldo mora no sessionService
// (conclusão atômica); aqui só concessão, pagamento, cancelamento e a trilha.

import { eq, and, sql } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  schedulingPackageTemplates, schedulingClientPackages, schedulingPackageMovements, clients,
} from '../db/schema';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { remainingSessions, PaymentStatus } from '../domain/scheduling/packageDomain';
import { addDaysISO } from '../domain/scheduling/timeDomain';
import { wallClockInTimezone } from '../domain/scheduling/advanceDomain';
import { getAreaOrThrow } from './schedulingAreaService';
import { getOrCreateSettings } from './schedulingSettingsService';

export type DrizzleDB = typeof _db;

// ── Modelos ───────────────────────────────────────────────────────────────────

export async function listTemplates(tenantId: string, includeInactive: boolean, db: DrizzleDB = _db) {
  const where = includeInactive
    ? eq(schedulingPackageTemplates.tenant_id, tenantId)
    : and(eq(schedulingPackageTemplates.tenant_id, tenantId), eq(schedulingPackageTemplates.is_active, true));
  const rows = await db.select().from(schedulingPackageTemplates).where(where);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface TemplateArgs {
  name:          string;
  areaId?:       string | null;
  sessionCount:  number;
  price?:        number;
  validityDays?: number | null;
}

function validateTemplateArgs(args: Partial<TemplateArgs>) {
  if (args.name !== undefined && !args.name.trim()) {
    throw new SchedulingDomainError('template_name_required');
  }
  if (args.sessionCount !== undefined &&
      (!Number.isInteger(args.sessionCount) || args.sessionCount <= 0)) {
    throw new SchedulingDomainError('invalid_session_count', { value: args.sessionCount });
  }
  if (args.validityDays !== undefined && args.validityDays !== null &&
      (!Number.isInteger(args.validityDays) || args.validityDays <= 0)) {
    throw new SchedulingDomainError('invalid_validity_days', { value: args.validityDays });
  }
}

export async function createTemplate(tenantId: string, args: TemplateArgs, createdBy: string | null, db: DrizzleDB = _db) {
  validateTemplateArgs(args);
  if (args.areaId) await getAreaOrThrow(args.areaId, tenantId, db);

  const [tpl] = await db.insert(schedulingPackageTemplates).values({
    tenant_id:     tenantId,
    name:          args.name.trim(),
    area_id:       args.areaId ?? null,
    session_count: args.sessionCount,
    price:         String(args.price ?? 0),
    validity_days: args.validityDays ?? null,
    created_by:    createdBy,
  }).returning();
  return tpl;
}

export async function getTemplateOrThrow(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [tpl] = await db.select().from(schedulingPackageTemplates)
    .where(and(eq(schedulingPackageTemplates.id, id), eq(schedulingPackageTemplates.tenant_id, tenantId)));
  if (!tpl) throw new SchedulingDomainError('template_not_found', { id });
  return tpl;
}

export async function updateTemplate(id: string, tenantId: string, args: Partial<TemplateArgs> & { isActive?: boolean }, db: DrizzleDB = _db) {
  await getTemplateOrThrow(id, tenantId, db);
  validateTemplateArgs(args);
  if (args.areaId) await getAreaOrThrow(args.areaId, tenantId, db);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name         !== undefined) patch.name          = args.name.trim();
  if (args.areaId       !== undefined) patch.area_id       = args.areaId;
  if (args.sessionCount !== undefined) patch.session_count = args.sessionCount;
  if (args.price        !== undefined) patch.price         = String(args.price);
  if (args.validityDays !== undefined) patch.validity_days = args.validityDays;
  if (args.isActive     !== undefined) patch.is_active     = args.isActive;

  const [updated] = await db.update(schedulingPackageTemplates).set(patch)
    .where(eq(schedulingPackageTemplates.id, id)).returning();
  return updated;
}

/** Modelos somem por soft-delete — concessões antigas mantêm o snapshot. */
export async function deactivateTemplate(id: string, tenantId: string, db: DrizzleDB = _db) {
  return updateTemplate(id, tenantId, { isActive: false }, db);
}

// ── Pacotes do cliente ────────────────────────────────────────────────────────

/** Status efetivo derivado na leitura: 'active' com validade vencida aparece
 *  como 'expired' sem escrita — a verdade continua sendo derivada. */
function effectiveStatus(pkg: { status: string; valid_until: string | null }, todayISO: string): string {
  if (pkg.status === 'active' && pkg.valid_until !== null && todayISO > pkg.valid_until) {
    return 'expired';
  }
  return pkg.status;
}

function packageView(pkg: any, todayISO: string) {
  return {
    ...pkg,
    status: effectiveStatus(pkg, todayISO),
    remaining_sessions: remainingSessions({ totalSessions: pkg.total_sessions, usedSessions: pkg.used_sessions }),
  };
}

async function todayInTenantTz(tenantId: string, db: DrizzleDB, now: Date): Promise<string> {
  const settings = await getOrCreateSettings(tenantId, db);
  return wallClockInTimezone(settings.timezone, now).date;
}

export interface GrantPackageArgs {
  tenantId:       string;
  clientId:       string;
  templateId?:    string | null;
  // Campos ad-hoc (obrigatórios sem template; com template, sobrescrevem o snapshot)
  name?:          string;
  areaId?:        string | null;
  totalSessions?: number;
  price?:         number;
  validityDays?:  number | null;
  paymentStatus?: PaymentStatus;
  notes?:         string | null;
  saveAsTemplate?: boolean;
  createdBy?:     string | null;
}

export async function grantPackage(args: GrantPackageArgs, db: DrizzleDB = _db, now: Date = new Date()) {
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, args.clientId), eq(clients.tenant_id, args.tenantId)));
  if (!client) throw new SchedulingDomainError('client_not_found', { id: args.clientId });

  // Snapshot: template preenche, ad-hoc sobrescreve.
  const tpl = args.templateId ? await getTemplateOrThrow(args.templateId, args.tenantId, db) : null;
  const name = (args.name ?? tpl?.name)?.trim();
  const areaId = args.areaId !== undefined ? args.areaId : (tpl?.area_id ?? null);
  const totalSessions = args.totalSessions ?? tpl?.session_count;
  const price = args.price ?? (tpl ? Number(tpl.price) : 0);
  const validityDays = args.validityDays !== undefined ? args.validityDays : (tpl?.validity_days ?? null);

  if (!name) throw new SchedulingDomainError('package_name_required');
  if (!Number.isInteger(totalSessions) || (totalSessions as number) <= 0) {
    throw new SchedulingDomainError('invalid_session_count', { value: totalSessions });
  }
  if (validityDays !== null && (!Number.isInteger(validityDays) || validityDays <= 0)) {
    throw new SchedulingDomainError('invalid_validity_days', { value: validityDays });
  }
  if (areaId) await getAreaOrThrow(areaId, args.tenantId, db);

  const todayISO = await todayInTenantTz(args.tenantId, db, now);
  const validUntil = validityDays !== null ? addDaysISO(todayISO, validityDays) : null;

  const pkg = await db.transaction(async (tx) => {
    const [created] = await tx.insert(schedulingClientPackages).values({
      tenant_id:      args.tenantId,
      client_id:      args.clientId,
      template_id:    args.templateId ?? null,
      area_id:        areaId,
      name:           name as string,
      total_sessions: totalSessions as number,
      price:          String(price),
      payment_status: args.paymentStatus ?? 'pending',
      valid_until:    validUntil,
      notes:          args.notes ?? null,
      created_by:     args.createdBy ?? null,
    }).returning();

    if (args.saveAsTemplate && !args.templateId) {
      await tx.insert(schedulingPackageTemplates).values({
        tenant_id:     args.tenantId,
        name:          name as string,
        area_id:       areaId,
        session_count: totalSessions as number,
        price:         String(price),
        validity_days: validityDays,
        created_by:    args.createdBy ?? null,
      });
    }
    return created;
  });

  return packageView(pkg, todayISO);
}

export interface ListClientPackagesArgs {
  tenantId: string;
  clientId?: string;
  status?:   string;
  page:      number;
  perPage:   number;
}

export async function listClientPackages(args: ListClientPackagesArgs, db: DrizzleDB = _db, now: Date = new Date()) {
  const conditions = [eq(schedulingClientPackages.tenant_id, args.tenantId)];
  if (args.clientId) conditions.push(eq(schedulingClientPackages.client_id, args.clientId));
  const where = and(...conditions);

  const limit = Math.min(args.perPage || 20, 100);
  const offset = (Math.max(args.page || 1, 1) - 1) * limit;

  const [rows, [cnt]] = await Promise.all([
    db.select({
      pkg: schedulingClientPackages,
      client_name: sql<string>`COALESCE(${clients.company_name}, ${clients.full_name})`,
    }).from(schedulingClientPackages)
      .leftJoin(clients, eq(schedulingClientPackages.client_id, clients.id))
      .where(where)
      .orderBy(sql`${schedulingClientPackages.created_at} DESC`)
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(schedulingClientPackages).where(where),
  ]);

  const todayISO = await todayInTenantTz(args.tenantId, db, now);
  let data = rows.map(r => ({ ...packageView(r.pkg, todayISO), client_name: r.client_name }));
  // Filtro de status usa o status EFETIVO (um 'active' vencido é 'expired').
  if (args.status) data = data.filter(p => p.status === args.status);

  return { data, total: cnt.count, page: Math.max(args.page || 1, 1), per_page: limit };
}

export async function getPackageOrThrow(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [pkg] = await db.select().from(schedulingClientPackages)
    .where(and(eq(schedulingClientPackages.id, id), eq(schedulingClientPackages.tenant_id, tenantId)));
  if (!pkg) throw new SchedulingDomainError('package_not_found', { id });
  return pkg;
}

export async function updatePackageNotes(id: string, tenantId: string, notes: string | null, db: DrizzleDB = _db) {
  await getPackageOrThrow(id, tenantId, db);
  const [updated] = await db.update(schedulingClientPackages)
    .set({ notes, updated_at: new Date() })
    .where(eq(schedulingClientPackages.id, id)).returning();
  return updated;
}

export async function setPaymentStatus(id: string, tenantId: string, paymentStatus: PaymentStatus, db: DrizzleDB = _db) {
  await getPackageOrThrow(id, tenantId, db);
  const [updated] = await db.update(schedulingClientPackages)
    .set({ payment_status: paymentStatus, updated_at: new Date() })
    .where(eq(schedulingClientPackages.id, id)).returning();
  return updated;
}

export async function cancelPackage(id: string, tenantId: string, db: DrizzleDB = _db) {
  const pkg = await getPackageOrThrow(id, tenantId, db);
  if (pkg.status === 'canceled') throw new SchedulingDomainError('package_already_canceled', { id });
  const [updated] = await db.update(schedulingClientPackages)
    .set({ status: 'canceled', updated_at: new Date() })
    .where(eq(schedulingClientPackages.id, id)).returning();
  return updated;
}

export async function listMovements(packageId: string, tenantId: string, db: DrizzleDB = _db) {
  await getPackageOrThrow(packageId, tenantId, db);
  const rows = await db.select().from(schedulingPackageMovements)
    .where(and(
      eq(schedulingPackageMovements.package_id, packageId),
      eq(schedulingPackageMovements.tenant_id, tenantId),
    ));
  return rows.sort((a, b) => (a.created_at as Date).getTime() - (b.created_at as Date).getTime());
}
