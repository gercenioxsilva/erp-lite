// Application Service — Sessões de agendamento (o coração do módulo).
//
// CONCORRÊNCIA (regra crítica nº 4): a checagem de conflito é atômica com a
// gravação. Estratégia: pg_advisory_xact_lock com chave (professional_id:date)
// dentro da transação — dois agendamentos concorrentes do mesmo profissional
// no mesmo dia serializam; o segundo enxerga o primeiro e falha com
// 'session_conflict'. SELECT ... FOR UPDATE não serve aqui: numa agenda vazia
// não há linha para travar (problema do phantom). O constraint EXCLUDE da
// migration 0060 é o backstop físico (23P01 ⇒ 'session_conflict') para
// qualquer caminho que esqueça o lock.
//
// CONCLUSÃO ATÔMICA (regra crítica nº 5): uma única transação com ordem de
// locks documentada (sessão → pacote, sempre nessa ordem ⇒ sem deadlock):
// FOR UPDATE na sessão (dupla conclusão morre aqui) → FOR UPDATE no pacote
// (precedente: costCenterStock) → débito de 1 + movimento imutável com
// idempotency_key 'session_completed:<id>' (UNIQUE ⇒ backstop físico) →
// sessão completed. Cancelamento nunca mexe em saldo (regra nº 6).

import { sql, eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import {
  schedulingSessions, schedulingClientPackages, schedulingPackageMovements,
  schedulingProfessionalAreas, schedulingAvailabilityRules, schedulingAvailabilityExceptions,
  clients,
} from '../db/schema';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { TimeRange, minutesToHm, hmToMinutes, isValidDateISO, weekdayOf } from '../domain/scheduling/timeDomain';
import {
  SessionStatus, findConflict, BLOCKING_STATUSES,
  assertCanApprove, assertCanDecline, assertCanComplete, assertCanCancel,
  assertCanEdit, assertCanHardDelete, assertClientCanCancel,
} from '../domain/scheduling/sessionDomain';
import { computeFreeSlots, EarliestBookable } from '../domain/scheduling/slotDomain';
import { assertPackageUsableForBooking, applyDebit } from '../domain/scheduling/packageDomain';
import {
  earliestBookableInstant, violatesMinAdvance, wallClockInTimezone, withinCancelWindow,
} from '../domain/scheduling/advanceDomain';
import { getOrCreateSettings } from './schedulingSettingsService';
import { getAreaOrThrow } from './schedulingAreaService';
import { getProfessionalOrThrow } from './schedulingProfessionalService';

export type DrizzleDB = typeof _db;
export { SchedulingDomainError };

// ── Infra de conflito ─────────────────────────────────────────────────────────

/** Serializa escritas da agenda de UM profissional em UM dia. Chave hasheada
 *  com seed fixa; colisão de hash só custa serialização extra, nunca corrupção. */
async function lockAgenda(tx: DrizzleDB, professionalId: string, date: string): Promise<void> {
  const key = `scheduling:${professionalId}:${date}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 42))`);
}

interface DayBlocker {
  id:             string;
  professionalId: string;
  areaId:         string;
  clientName:     string;
  range:          TimeRange;
  status:         SessionStatus;
}

/** Sessões que seguram horário (pending/confirmed) do profissional no dia. */
async function loadDayBlockers(
  tx: DrizzleDB, tenantId: string, professionalId: string, date: string, excludeId?: string,
): Promise<DayBlocker[]> {
  const rows = await tx.select({
    id:          schedulingSessions.id,
    area_id:     schedulingSessions.area_id,
    client_name: schedulingSessions.client_name,
    start_time:  schedulingSessions.start_time,
    end_time:    schedulingSessions.end_time,
    status:      schedulingSessions.status,
  }).from(schedulingSessions)
    .where(and(
      eq(schedulingSessions.tenant_id, tenantId),
      eq(schedulingSessions.professional_id, professionalId),
      eq(schedulingSessions.date, date),
      sql`${schedulingSessions.status} IN ('pending', 'confirmed')`,
    ));

  return rows
    .filter(r => !excludeId || r.id !== excludeId)
    .map(r => ({
      id:             r.id,
      professionalId,
      areaId:         r.area_id,
      clientName:     r.client_name,
      range:          { start: r.start_time, end: r.end_time },
      status:         r.status as SessionStatus,
    }));
}

/** Erro citando o cliente e o horário conflitantes — vira a mensagem da UI. */
function throwConflict(hit: DayBlocker): never {
  throw new SchedulingDomainError('session_conflict', {
    conflicting: {
      session_id:  hit.id,
      client_name: hit.clientName,
      start_time:  hit.range.start,
      end_time:    hit.range.end,
      status:      hit.status,
    },
  });
}

async function assertProfessionalServesArea(
  professionalId: string, areaId: string, tenantId: string, db: DrizzleDB,
): Promise<void> {
  const [link] = await db.select({ id: schedulingProfessionalAreas.id })
    .from(schedulingProfessionalAreas)
    .where(and(
      eq(schedulingProfessionalAreas.tenant_id, tenantId),
      eq(schedulingProfessionalAreas.professional_id, professionalId),
      eq(schedulingProfessionalAreas.area_id, areaId),
    ));
  if (!link) throw new SchedulingDomainError('professional_area_mismatch', { professional_id: professionalId, area_id: areaId });
}

async function getClientNameOrThrow(clientId: string, tenantId: string, db: DrizzleDB): Promise<string> {
  const [row] = await db.select({
    name: sql<string>`COALESCE(${clients.company_name}, ${clients.full_name})`,
  }).from(clients).where(and(eq(clients.id, clientId), eq(clients.tenant_id, tenantId)));
  if (!row) throw new SchedulingDomainError('client_not_found', { id: clientId });
  return row.name ?? '';
}

/** Valida o pacote escolhido (opcional — decisão nº 8: agendar sem pacote é
 *  livre). Confere posse do cliente + status/validade/área. */
async function assertChosenPackageUsable(
  packageId: string, clientId: string, areaId: string, tenantId: string, db: DrizzleDB, now: Date,
): Promise<void> {
  const [pkg] = await db.select().from(schedulingClientPackages)
    .where(and(
      eq(schedulingClientPackages.id, packageId),
      eq(schedulingClientPackages.tenant_id, tenantId),
    ));
  if (!pkg || pkg.client_id !== clientId) {
    throw new SchedulingDomainError('package_not_found', { id: packageId });
  }
  const settings = await getOrCreateSettings(tenantId, db);
  const todayISO = wallClockInTimezone(settings.timezone, now).date;
  assertPackageUsableForBooking({
    status:        pkg.status as any,
    areaId:        pkg.area_id,
    validUntil:    pkg.valid_until,
    totalSessions: pkg.total_sessions,
    usedSessions:  pkg.used_sessions,
  }, areaId, todayISO);
}

// ── Leituras ──────────────────────────────────────────────────────────────────

export interface ListSessionsArgs {
  tenantId:  string;
  /** Recorte "só a própria agenda" — null/undefined = irrestrito. */
  restrictToProfessionalId?: string | null;
  professionalId?: string;
  clientId?:       string;
  areaId?:         string;
  status?:         string;
  from?:           string;
  to?:             string;
  page:            number;
  perPage:         number;
}

export async function listSessions(args: ListSessionsArgs, db: DrizzleDB = _db) {
  const conditions = [eq(schedulingSessions.tenant_id, args.tenantId)];
  if (args.restrictToProfessionalId) conditions.push(eq(schedulingSessions.professional_id, args.restrictToProfessionalId));
  if (args.professionalId) conditions.push(eq(schedulingSessions.professional_id, args.professionalId));
  if (args.clientId)       conditions.push(eq(schedulingSessions.client_id, args.clientId));
  if (args.areaId)         conditions.push(eq(schedulingSessions.area_id, args.areaId));
  if (args.status)         conditions.push(eq(schedulingSessions.status, args.status));
  if (args.from)           conditions.push(sql`${schedulingSessions.date} >= ${args.from}`);
  if (args.to)             conditions.push(sql`${schedulingSessions.date} <= ${args.to}`);
  const where = and(...conditions);

  const limit = Math.min(args.perPage || 20, 100);
  const offset = (Math.max(args.page || 1, 1) - 1) * limit;

  const [rows, [cnt]] = await Promise.all([
    db.select().from(schedulingSessions).where(where)
      .orderBy(sql`${schedulingSessions.date} DESC, ${schedulingSessions.start_time} DESC`)
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(schedulingSessions).where(where),
  ]);

  return { data: rows, total: cnt.count, page: Math.max(args.page || 1, 1), per_page: limit };
}

export async function getSessionOrThrow(id: string, tenantId: string, db: DrizzleDB = _db) {
  const [session] = await db.select().from(schedulingSessions)
    .where(and(eq(schedulingSessions.id, id), eq(schedulingSessions.tenant_id, tenantId)));
  if (!session) throw new SchedulingDomainError('session_not_found', { id });
  return session;
}

// ── Engine de slots (compartilhado admin/portal) ──────────────────────────────

export interface GetSlotsArgs {
  tenantId:          string;
  professionalId:    string;
  areaId:            string;
  date:              string;
  /** true no portal (corta por min_advance_hours); false no form do admin. */
  enforceMinAdvance: boolean;
}

export async function getAvailableSlots(args: GetSlotsArgs, db: DrizzleDB = _db, now: Date = new Date()): Promise<TimeRange[]> {
  if (!isValidDateISO(args.date)) throw new SchedulingDomainError('invalid_date_format', { value: args.date });
  const area = await getAreaOrThrow(args.areaId, args.tenantId, db);
  await getProfessionalOrThrow(args.professionalId, args.tenantId, db);

  const weekday = weekdayOf(args.date);
  const [rules, exceptions, blockers, settings] = await Promise.all([
    db.select().from(schedulingAvailabilityRules)
      .where(and(
        eq(schedulingAvailabilityRules.tenant_id, args.tenantId),
        eq(schedulingAvailabilityRules.professional_id, args.professionalId),
        eq(schedulingAvailabilityRules.weekday, weekday),
      )),
    db.select().from(schedulingAvailabilityExceptions)
      .where(and(
        eq(schedulingAvailabilityExceptions.tenant_id, args.tenantId),
        eq(schedulingAvailabilityExceptions.professional_id, args.professionalId),
        eq(schedulingAvailabilityExceptions.date, args.date),
      )),
    loadDayBlockers(db, args.tenantId, args.professionalId, args.date),
    getOrCreateSettings(args.tenantId, db),
  ]);

  let earliest: EarliestBookable | null = null;
  if (args.enforceMinAdvance) {
    earliest = earliestBookableInstant(settings.timezone, settings.min_advance_hours, now);
  }

  return computeFreeSlots({
    weeklyRanges: rules.map(r => ({ start: r.start_time, end: r.end_time })),
    exceptions: exceptions.map(e => ({
      kind: e.kind as 'block' | 'open',
      startTime: e.start_time,
      endTime: e.end_time,
    })),
    // Ocupados da MESMA faixa (profissional, área) — outra área não bloqueia.
    occupied: blockers.filter(b => b.areaId === args.areaId).map(b => b.range),
    durationMinutes: area.default_duration_minutes,
    date: args.date,
    earliest,
  });
}

// ── Escritas ──────────────────────────────────────────────────────────────────

export interface CreateSessionArgs {
  tenantId:       string;
  professionalId: string;
  clientId:       string;
  areaId:         string;
  packageId?:     string | null;
  date:           string;
  startTime:      string;
  endTime?:       string | null; // omitido ⇒ start + duração da área
  notes?:         string | null;
  createdBy?:     string | null;
}

/**
 * Agendamento pelo staff: nasce 'confirmed'. A grade de disponibilidade NÃO é
 * imposta aqui (a grade é um construto do auto-agendamento; o admin pode furar
 * de propósito — a UI apenas avisa). O que É imposto: conflito atômico,
 * vínculo profissional↔área e revalidação do pacote escolhido (regra nº 9).
 */
export async function createSession(args: CreateSessionArgs, db: DrizzleDB = _db, now: Date = new Date()) {
  if (!isValidDateISO(args.date)) throw new SchedulingDomainError('invalid_date_format', { value: args.date });

  const area = await getAreaOrThrow(args.areaId, args.tenantId, db);
  if (!area.is_active) throw new SchedulingDomainError('area_inactive', { id: args.areaId });
  const prof = await getProfessionalOrThrow(args.professionalId, args.tenantId, db);
  if (!prof.is_active) throw new SchedulingDomainError('professional_inactive', { id: args.professionalId });
  await assertProfessionalServesArea(args.professionalId, args.areaId, args.tenantId, db);
  const clientName = await getClientNameOrThrow(args.clientId, args.tenantId, db);

  const startTime = args.startTime;
  const endTime = args.endTime ?? minutesToHm(hmToMinutes(startTime) + area.default_duration_minutes);
  if (startTime >= endTime) throw new SchedulingDomainError('invalid_time_range', { start: startTime, end: endTime });

  if (args.packageId) {
    await assertChosenPackageUsable(args.packageId, args.clientId, args.areaId, args.tenantId, db, now);
  }

  return db.transaction(async (tx) => {
    await lockAgenda(tx as unknown as DrizzleDB, args.professionalId, args.date);
    const blockers = await loadDayBlockers(tx as unknown as DrizzleDB, args.tenantId, args.professionalId, args.date);
    const hit = findConflict(
      { professionalId: args.professionalId, areaId: args.areaId, range: { start: startTime, end: endTime } },
      blockers,
    );
    if (hit) throwConflict(hit);

    const [session] = await tx.insert(schedulingSessions).values({
      tenant_id:       args.tenantId,
      professional_id: args.professionalId,
      client_id:       args.clientId,
      client_name:     clientName,
      area_id:         args.areaId,
      package_id:      args.packageId ?? null,
      date:            args.date,
      start_time:      startTime,
      end_time:        endTime,
      status:          'confirmed',
      requested_by:    'professional',
      notes:           args.notes ?? null,
      created_by:      args.createdBy ?? null,
    }).returning();
    return session;
  }).catch(mapExclusionViolation);
}

export interface RequestSessionAsClientArgs {
  tenantId:       string;
  clientId:       string;
  clientUserId:   string;
  professionalId: string;
  areaId:         string;
  packageId?:     string | null;
  date:           string;
  startTime:      string;
  notes?:         string | null;
}

/**
 * Auto-agendamento pelo portal: nasce 'pending' e SEGURA o horário (regra
 * nº 3). Toda regra de UI é revalidada aqui (regra nº 9): módulo habilitado
 * já foi checado na rota; aqui: allow_self_booking, antecedência mínima no
 * fuso do tenant e o slot precisa ser EXATAMENTE um dos ofertados pelo engine.
 */
export async function requestSessionAsClient(args: RequestSessionAsClientArgs, db: DrizzleDB = _db, now: Date = new Date()) {
  const settings = await getOrCreateSettings(args.tenantId, db);
  if (!settings.allow_self_booking) throw new SchedulingDomainError('self_booking_disabled');
  if (!isValidDateISO(args.date)) throw new SchedulingDomainError('invalid_date_format', { value: args.date });

  const area = await getAreaOrThrow(args.areaId, args.tenantId, db);
  if (!area.is_active) throw new SchedulingDomainError('area_inactive', { id: args.areaId });
  const prof = await getProfessionalOrThrow(args.professionalId, args.tenantId, db);
  if (!prof.is_active) throw new SchedulingDomainError('professional_inactive', { id: args.professionalId });
  await assertProfessionalServesArea(args.professionalId, args.areaId, args.tenantId, db);
  const clientName = await getClientNameOrThrow(args.clientId, args.tenantId, db);

  if (args.packageId) {
    await assertChosenPackageUsable(args.packageId, args.clientId, args.areaId, args.tenantId, db, now);
  }

  const earliest = earliestBookableInstant(settings.timezone, settings.min_advance_hours, now);
  if (violatesMinAdvance(args.date, args.startTime, earliest)) {
    throw new SchedulingDomainError('min_advance_violation', {
      min_advance_hours: settings.min_advance_hours, earliest,
    });
  }

  // O pedido tem que casar com um slot ofertado — grade vazia nunca vira
  // "tudo livre" porque o engine devolve [] e o pedido cai aqui.
  const slots = await getAvailableSlots({
    tenantId: args.tenantId, professionalId: args.professionalId,
    areaId: args.areaId, date: args.date, enforceMinAdvance: true,
  }, db, now);
  const slot = slots.find(s => s.start === args.startTime);
  if (!slot) throw new SchedulingDomainError('slot_unavailable', { date: args.date, start_time: args.startTime });

  return db.transaction(async (tx) => {
    await lockAgenda(tx as unknown as DrizzleDB, args.professionalId, args.date);
    const blockers = await loadDayBlockers(tx as unknown as DrizzleDB, args.tenantId, args.professionalId, args.date);
    const hit = findConflict(
      { professionalId: args.professionalId, areaId: args.areaId, range: slot },
      blockers,
    );
    if (hit) throwConflict(hit);

    const [session] = await tx.insert(schedulingSessions).values({
      tenant_id:       args.tenantId,
      professional_id: args.professionalId,
      client_id:       args.clientId,
      client_name:     clientName,
      area_id:         args.areaId,
      package_id:      args.packageId ?? null,
      date:            args.date,
      start_time:      slot.start,
      end_time:        slot.end,
      status:          'pending',
      requested_by:    'client',
      notes:           args.notes ?? null,
      created_by:      args.clientUserId,
    }).returning();
    return session;
  }).catch(mapExclusionViolation);
}

/** Aprovação RE-CHECA o conflito atomicamente (critério de aceite): entre o
 *  pedido e o aceite, o profissional pode ter agendado outra coisa. */
export async function approveSession(id: string, tenantId: string, db: DrizzleDB = _db) {
  return db.transaction(async (tx) => {
    const [session] = await tx.execute(sql`
      SELECT * FROM scheduling_sessions
      WHERE id = ${id} AND tenant_id = ${tenantId}
      FOR UPDATE
    `).then((r: any) => r.rows);
    if (!session) throw new SchedulingDomainError('session_not_found', { id });
    assertCanApprove(session.status as SessionStatus);

    await lockAgenda(tx as unknown as DrizzleDB, session.professional_id, session.date);
    const blockers = await loadDayBlockers(
      tx as unknown as DrizzleDB, tenantId, session.professional_id, session.date, id,
    );
    const hit = findConflict({
      professionalId: session.professional_id,
      areaId:         session.area_id,
      range:          { start: session.start_time, end: session.end_time },
    }, blockers);
    if (hit) throwConflict(hit);

    const [updated] = await tx.update(schedulingSessions)
      .set({ status: 'confirmed', updated_at: new Date() })
      .where(eq(schedulingSessions.id, id)).returning();
    return updated;
  });
}

export async function declineSession(id: string, tenantId: string, reason: string, db: DrizzleDB = _db) {
  const session = await getSessionOrThrow(id, tenantId, db);
  assertCanDecline(session.status as SessionStatus, reason);

  const [updated] = await db.update(schedulingSessions)
    .set({ status: 'declined', decline_reason: reason.trim(), updated_at: new Date() })
    .where(eq(schedulingSessions.id, id)).returning();
  return updated;
}

/**
 * Conclusão atômica (regra crítica nº 5): completed + débito de exatamente 1
 * na MESMA transação. Ordem de locks fixa (sessão → pacote) evita deadlock.
 */
export async function completeSession(id: string, tenantId: string, userId: string | null, db: DrizzleDB = _db) {
  return db.transaction(async (tx) => {
    // 1. Sessão sob FOR UPDATE — a segunda conclusão concorrente espera aqui
    //    e morre no assertCanComplete ao enxergar 'completed'.
    const [session] = await tx.execute(sql`
      SELECT * FROM scheduling_sessions
      WHERE id = ${id} AND tenant_id = ${tenantId}
      FOR UPDATE
    `).then((r: any) => r.rows);
    if (!session) throw new SchedulingDomainError('session_not_found', { id });
    assertCanComplete(session.status as SessionStatus);

    // 2. Débito do pacote (se houver) sob FOR UPDATE na linha do saldo —
    //    precedente direto de costCenterStock.applyEntry.
    if (session.package_id) {
      const [pkg] = await tx.execute(sql`
        SELECT * FROM scheduling_client_packages
        WHERE id = ${session.package_id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `).then((r: any) => r.rows);
      if (!pkg) throw new SchedulingDomainError('package_not_found', { id: session.package_id });

      const debit = applyDebit({ totalSessions: pkg.total_sessions, usedSessions: pkg.used_sessions });

      await tx.update(schedulingClientPackages)
        .set({ used_sessions: debit.usedSessions, status: debit.status, updated_at: new Date() })
        .where(eq(schedulingClientPackages.id, session.package_id));

      await tx.insert(schedulingPackageMovements).values({
        tenant_id:       tenantId,
        package_id:      session.package_id,
        session_id:      id,
        direction:       'debit',
        quantity:        1,
        balance_after:   pkg.total_sessions - debit.usedSessions,
        reason:          'session_completed',
        idempotency_key: `session_completed:${id}`,
        created_by:      userId,
      });
    }

    // 3. Sessão vira completed — imutável dali em diante.
    const [updated] = await tx.update(schedulingSessions)
      .set({ status: 'completed', completed_at: new Date(), updated_at: new Date() })
      .where(eq(schedulingSessions.id, id)).returning();
    return updated;
  }).catch((err: any) => {
    // Backstop físico do débito duplo: UNIQUE do idempotency_key.
    if (err?.code === '23505') throw new SchedulingDomainError('session_already_completed', { id });
    throw err;
  });
}

export interface UpdateSessionArgs {
  professionalId?: string;
  areaId?:         string;
  packageId?:      string | null;
  date?:           string;
  startTime?:      string;
  endTime?:        string;
  notes?:          string | null;
}

/** Edição (pending/confirmed): mudou profissional/área/dia/horário ⇒ re-checa
 *  conflito com o mesmo lock do create. completed é imutável (assertCanEdit). */
export async function updateSession(id: string, tenantId: string, args: UpdateSessionArgs, db: DrizzleDB = _db, now: Date = new Date()) {
  const session = await getSessionOrThrow(id, tenantId, db);
  assertCanEdit(session.status as SessionStatus);

  const professionalId = args.professionalId ?? session.professional_id;
  const areaId = args.areaId ?? session.area_id;
  const date = args.date ?? session.date;
  if (!isValidDateISO(date)) throw new SchedulingDomainError('invalid_date_format', { value: date });

  const timingChanged =
    professionalId !== session.professional_id || areaId !== session.area_id ||
    date !== session.date || (args.startTime !== undefined && args.startTime !== session.start_time) ||
    (args.endTime !== undefined && args.endTime !== session.end_time);

  const area = await getAreaOrThrow(areaId, tenantId, db);
  if (args.professionalId || args.areaId) {
    const prof = await getProfessionalOrThrow(professionalId, tenantId, db);
    if (!prof.is_active) throw new SchedulingDomainError('professional_inactive', { id: professionalId });
    await assertProfessionalServesArea(professionalId, areaId, tenantId, db);
  }

  const startTime = args.startTime ?? session.start_time;
  // Mudou início ou área sem fim explícito ⇒ rederiva da duração da área.
  const endTime = args.endTime ?? (
    (args.startTime !== undefined || args.areaId !== undefined)
      ? minutesToHm(hmToMinutes(startTime) + area.default_duration_minutes)
      : session.end_time
  );
  if (startTime >= endTime) throw new SchedulingDomainError('invalid_time_range', { start: startTime, end: endTime });

  if (args.packageId) {
    await assertChosenPackageUsable(args.packageId, session.client_id, areaId, tenantId, db, now);
  }

  return db.transaction(async (tx) => {
    if (timingChanged) {
      await lockAgenda(tx as unknown as DrizzleDB, professionalId, date);
      const blockers = await loadDayBlockers(tx as unknown as DrizzleDB, tenantId, professionalId, date, id);
      const hit = findConflict(
        { professionalId, areaId, range: { start: startTime, end: endTime } },
        blockers,
      );
      if (hit) throwConflict(hit);
    }

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (args.professionalId !== undefined) patch.professional_id = args.professionalId;
    if (args.areaId         !== undefined) patch.area_id         = args.areaId;
    if (args.packageId      !== undefined) patch.package_id      = args.packageId;
    if (args.date           !== undefined) patch.date            = args.date;
    patch.start_time = startTime;
    patch.end_time   = endTime;
    if (args.notes !== undefined) patch.notes = args.notes;

    const [updated] = await tx.update(schedulingSessions).set(patch)
      .where(eq(schedulingSessions.id, id)).returning();
    return updated;
  }).catch(mapExclusionViolation);
}

/** Soft-cancel auditado: libera o horário, NUNCA consome saldo (regra nº 6). */
export async function cancelSession(
  id: string, tenantId: string, opts: { byUserId: string | null; reason?: string | null }, db: DrizzleDB = _db,
) {
  const session = await getSessionOrThrow(id, tenantId, db);
  assertCanCancel(session.status as SessionStatus);

  const [updated] = await db.update(schedulingSessions)
    .set({
      status:        'canceled',
      canceled_at:   new Date(),
      canceled_by:   opts.byUserId,
      cancel_reason: opts.reason ?? null,
      updated_at:    new Date(),
    })
    .where(eq(schedulingSessions.id, id)).returning();
  return updated;
}

/**
 * Cancelamento pelo PRÓPRIO cliente no portal (regra nº 7 + decisão nº 9):
 * só a própria solicitação, só pending, e só fora da janela de cancelamento.
 * Sessão de outro cliente responde 'session_not_found' — não vaza existência.
 */
export async function cancelOwnPendingSession(
  id: string, tenantId: string, clientId: string, clientUserId: string,
  db: DrizzleDB = _db, now: Date = new Date(),
) {
  const session = await getSessionOrThrow(id, tenantId, db);
  if (session.client_id !== clientId) {
    throw new SchedulingDomainError('session_not_found', { id });
  }
  assertClientCanCancel(session.status as SessionStatus);

  const settings = await getOrCreateSettings(tenantId, db);
  if (withinCancelWindow(session.date, session.start_time, settings.cancel_window_hours, settings.timezone, now)) {
    throw new SchedulingDomainError('cancel_window_violation', {
      cancel_window_hours: settings.cancel_window_hours,
    });
  }

  const [updated] = await db.update(schedulingSessions)
    .set({
      status:      'canceled',
      canceled_at: new Date(),
      canceled_by: clientUserId,
      updated_at:  new Date(),
    })
    .where(eq(schedulingSessions.id, id)).returning();
  return updated;
}

/** Exclusão definitiva — só não-concluídas (regra nº 6). */
export async function deleteSession(id: string, tenantId: string, db: DrizzleDB = _db): Promise<void> {
  const session = await getSessionOrThrow(id, tenantId, db);
  assertCanHardDelete(session.status as SessionStatus);
  await db.delete(schedulingSessions)
    .where(and(eq(schedulingSessions.id, id), eq(schedulingSessions.tenant_id, tenantId)));
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getDashboard(
  tenantId: string, restrictToProfessionalId: string | null, db: DrizzleDB = _db, now: Date = new Date(),
) {
  const settings = await getOrCreateSettings(tenantId, db);
  const todayISO = wallClockInTimezone(settings.timezone, now).date;

  const scopeCond = restrictToProfessionalId
    ? sql` AND professional_id = ${restrictToProfessionalId}` : sql``;

  const [today, upcoming, [pendingCnt]] = await Promise.all([
    db.execute(sql`
      SELECT * FROM scheduling_sessions
      WHERE tenant_id = ${tenantId} AND date = ${todayISO}
        AND status IN ('pending', 'confirmed')${scopeCond}
      ORDER BY start_time ASC
    `).then((r: any) => r.rows),
    db.execute(sql`
      SELECT * FROM scheduling_sessions
      WHERE tenant_id = ${tenantId} AND date > ${todayISO}
        AND status IN ('pending', 'confirmed')${scopeCond}
      ORDER BY date ASC, start_time ASC
      LIMIT 10
    `).then((r: any) => r.rows),
    db.execute(sql`
      SELECT COUNT(*)::int AS count FROM scheduling_sessions
      WHERE tenant_id = ${tenantId} AND status = 'pending'${scopeCond}
    `).then((r: any) => r.rows),
  ]);

  return {
    today,
    upcoming,
    pending_requests: pendingCnt?.count ?? 0,
    date: todayISO,
    onboarding_complete: settings.onboarding_complete,
  };
}

// ── Mapeamento do backstop físico ─────────────────────────────────────────────

/** 23P01 = exclusion_violation do constraint scheduling_sessions_no_overlap —
 *  qualquer escrita que escape do advisory lock morre aqui como conflito. */
function mapExclusionViolation(err: any): never {
  if (err?.code === '23P01') {
    throw new SchedulingDomainError('session_conflict', {});
  }
  throw err;
}
