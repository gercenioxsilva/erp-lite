// Application Service — Profissionais do agendamento.
//
// Profissional é o staff agendável (barbeiro, instrutor). Login é OPCIONAL:
// user_id null = agenda gerenciada só pelo admin; user_id preenchido = usuário
// com papel 'professional' que opera a própria agenda. O recorte "só a própria
// agenda" (resolveAgendaScope) vem daqui: quem não tem scheduling:manage_all
// só enxerga/mexe no profissional vinculado ao seu user_id.
// Sem hard delete: sessões usam FK RESTRICT e histórico importa — desativar
// (is_active=false) tira o profissional dos pickers e do auto-agendamento.

import bcrypt from 'bcryptjs';
import { eq, and, inArray } from 'drizzle-orm';
import { db as _db } from '../db';
import { schedulingProfessionals, schedulingProfessionalAreas, schedulingAreas, users } from '../db/schema';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { getPermissionsForUser } from '../rbac/permissionService';
import { sendSystemNotification } from '../lib/notificationsClient';

export type DrizzleDB = typeof _db;

export interface ListProfessionalsArgs {
  tenantId:         string;
  areaId?:          string;
  includeInactive?: boolean;
}

export async function listProfessionals(args: ListProfessionalsArgs, db: DrizzleDB = _db) {
  const conditions = [eq(schedulingProfessionals.tenant_id, args.tenantId)];
  if (!args.includeInactive) conditions.push(eq(schedulingProfessionals.is_active, true));

  const rows = await db.select().from(schedulingProfessionals).where(and(...conditions));
  const profs = rows.sort((a, b) => a.name.localeCompare(b.name));

  if (profs.length === 0) return [];

  // Áreas de cada profissional em uma query só (filtro por área é aplicado
  // sobre o vínculo — profissional sem vínculo com a área não aparece).
  const links = await db.select({
    professional_id: schedulingProfessionalAreas.professional_id,
    area_id:         schedulingProfessionalAreas.area_id,
  }).from(schedulingProfessionalAreas)
    .where(and(
      eq(schedulingProfessionalAreas.tenant_id, args.tenantId),
      inArray(schedulingProfessionalAreas.professional_id, profs.map(p => p.id)),
    ));

  const areasByProf = new Map<string, string[]>();
  for (const link of links) {
    const list = areasByProf.get(link.professional_id) ?? [];
    list.push(link.area_id);
    areasByProf.set(link.professional_id, list);
  }

  const withAreas = profs.map(p => ({ ...p, area_ids: areasByProf.get(p.id) ?? [] }));
  return args.areaId ? withAreas.filter(p => p.area_ids.includes(args.areaId as string)) : withAreas;
}

export async function getProfessionalOrThrow(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [prof] = await db.select().from(schedulingProfessionals)
    .where(and(eq(schedulingProfessionals.id, id), eq(schedulingProfessionals.tenant_id, tenantId)));
  if (!prof) throw new SchedulingDomainError('professional_not_found', { id });
  return prof;
}

export async function getProfessionalByUserId(userId: string, tenantId: string, db: DrizzleDB = _db) {
  const [prof] = await db.select().from(schedulingProfessionals)
    .where(and(
      eq(schedulingProfessionals.user_id, userId),
      eq(schedulingProfessionals.tenant_id, tenantId),
    ));
  return prof ?? null;
}

/**
 * Recorte de agenda (decisão nº 7 do design): null = irrestrito
 * (scheduling:manage_all — dono/admin/gestor); senão, o id do profissional
 * vinculado ao usuário. Usuário sem manage_all E sem vínculo não opera
 * agenda nenhuma ⇒ 'not_own_agenda' (403 na rota).
 */
export async function resolveAgendaScope(
  tenantId: string, userId: string, role: string, db: DrizzleDB = _db,
): Promise<string | null> {
  const perms = await getPermissionsForUser(tenantId, role);
  if (perms.has('scheduling:manage_all')) return null;
  const prof = await getProfessionalByUserId(userId, tenantId, db);
  if (!prof) throw new SchedulingDomainError('not_own_agenda');
  return prof.id;
}

async function assertAreasBelongToTenant(areaIds: string[], tenantId: string, db: DrizzleDB) {
  if (areaIds.length === 0) return;
  const rows = await db.select({ id: schedulingAreas.id }).from(schedulingAreas)
    .where(and(eq(schedulingAreas.tenant_id, tenantId), inArray(schedulingAreas.id, areaIds)));
  if (rows.length !== new Set(areaIds).size) {
    throw new SchedulingDomainError('area_not_found', { area_ids: areaIds });
  }
}

export interface CreateProfessionalArgs {
  tenantId:   string;
  name:       string;
  email?:     string | null;
  phone?:     string | null;
  bio?:       string | null;
  areaIds?:   string[];
  userId?:    string | null; // vínculo direto (ex.: dono se cadastrando no onboarding)
  createdBy?: string | null;
}

export async function createProfessional(args: CreateProfessionalArgs, db: DrizzleDB = _db) {
  if (!args.name?.trim()) throw new SchedulingDomainError('professional_name_required');
  const areaIds = [...new Set(args.areaIds ?? [])];
  await assertAreasBelongToTenant(areaIds, args.tenantId, db);

  return db.transaction(async (tx) => {
    const [prof] = await tx.insert(schedulingProfessionals).values({
      tenant_id:  args.tenantId,
      name:       args.name.trim(),
      email:      args.email ?? null,
      phone:      args.phone ?? null,
      bio:        args.bio ?? null,
      user_id:    args.userId ?? null,
      created_by: args.createdBy ?? null,
    }).returning();

    for (const areaId of areaIds) {
      await tx.insert(schedulingProfessionalAreas).values({
        tenant_id: args.tenantId, professional_id: prof.id, area_id: areaId,
      });
    }
    return { ...prof, area_ids: areaIds };
  });
}

export interface UpdateProfessionalArgs {
  name?:     string;
  email?:    string | null;
  phone?:    string | null;
  bio?:      string | null;
  isActive?: boolean;
}

export async function updateProfessional(id: string, tenantId: string, args: UpdateProfessionalArgs, db: DrizzleDB = _db) {
  await getProfessionalOrThrow(id, tenantId, db);
  if (args.name !== undefined && !args.name.trim()) {
    throw new SchedulingDomainError('professional_name_required');
  }

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.name     !== undefined) patch.name      = args.name.trim();
  if (args.email    !== undefined) patch.email     = args.email;
  if (args.phone    !== undefined) patch.phone     = args.phone;
  if (args.bio      !== undefined) patch.bio       = args.bio;
  if (args.isActive !== undefined) patch.is_active = args.isActive;

  const [updated] = await db.update(schedulingProfessionals).set(patch)
    .where(eq(schedulingProfessionals.id, id)).returning();
  return updated;
}

/** Substitui o conjunto de áreas do profissional (replace-wholesale, em tx). */
export async function setProfessionalAreas(id: string, tenantId: string, areaIds: string[], db: DrizzleDB = _db) {
  await getProfessionalOrThrow(id, tenantId, db);
  const unique = [...new Set(areaIds)];
  await assertAreasBelongToTenant(unique, tenantId, db);

  await db.transaction(async (tx) => {
    await tx.delete(schedulingProfessionalAreas)
      .where(and(
        eq(schedulingProfessionalAreas.professional_id, id),
        eq(schedulingProfessionalAreas.tenant_id, tenantId),
      ));
    for (const areaId of unique) {
      await tx.insert(schedulingProfessionalAreas).values({
        tenant_id: tenantId, professional_id: id, area_id: areaId,
      });
    }
  });
  return unique;
}

export interface ProvisionProfessionalUserArgs {
  professionalId: string;
  tenantId:       string;
  email:          string;
  password:       string;
}

/**
 * Cria o login do profissional (papel 'professional' hard-coded — por isso a
 * rota pode exigir só users:create) e vincula ao cadastro. Notificação de
 * boas-vindas segue o fluxo fire-and-forget de routes/users.ts.
 */
export async function provisionProfessionalUser(args: ProvisionProfessionalUserArgs, db: DrizzleDB = _db) {
  const prof = await getProfessionalOrThrow(args.professionalId, args.tenantId, db);
  if (prof.user_id) throw new SchedulingDomainError('professional_already_has_user');

  const passwordHash = await bcrypt.hash(args.password, 12);
  const displayName = prof.name;

  const user = await db.transaction(async (tx) => {
    let created;
    try {
      [created] = await tx.insert(users).values({
        tenant_id:     args.tenantId,
        email:         args.email,
        name:          displayName,
        password_hash: passwordHash,
        role:          'professional',
        status:        'active',
      }).returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    } catch (err: any) {
      if (err.code === '23505') throw new SchedulingDomainError('email_already_in_use', { email: args.email });
      throw err;
    }

    await tx.update(schedulingProfessionals)
      .set({ user_id: created.id, updated_at: new Date() })
      .where(eq(schedulingProfessionals.id, args.professionalId));
    return created;
  });

  sendSystemNotification({
    tenant_id: args.tenantId,
    type:      'user_welcome',
    recipient: { email: args.email, name: displayName },
    data: {
      name:      displayName,
      email:     args.email,
      password:  args.password,
      login_url: process.env.APP_URL ?? 'https://orquestraerp.com.br',
    },
  }).catch(() => { /* falha de e-mail não pode derrubar a criação */ });

  return user;
}
