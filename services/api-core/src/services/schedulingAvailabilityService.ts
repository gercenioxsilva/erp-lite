// Application Service — Disponibilidade do profissional.
// Grade semanal (replace-wholesale em tx: a UI edita a semana inteira e salva)
// + exceções por data (bloqueio dia inteiro/faixa, abertura extra).
// Faixas sobrepostas na mesma semana são aceitas — o engine de slots normaliza
// com mergeRanges na leitura, então não há estado inválido possível.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { schedulingAvailabilityRules, schedulingAvailabilityExceptions } from '../db/schema';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';
import { validateWeeklyRule, validateException } from '../domain/scheduling/slotDomain';
import { isValidDateISO } from '../domain/scheduling/timeDomain';
import { getProfessionalOrThrow } from './schedulingProfessionalService';

export type DrizzleDB = typeof _db;

export async function getAvailability(professionalId: string, tenantId: string, db: DrizzleDB = _db) {
  await getProfessionalOrThrow(professionalId, tenantId, db);

  const [weekly, exceptions] = await Promise.all([
    db.select().from(schedulingAvailabilityRules)
      .where(and(
        eq(schedulingAvailabilityRules.professional_id, professionalId),
        eq(schedulingAvailabilityRules.tenant_id, tenantId),
      )),
    db.select().from(schedulingAvailabilityExceptions)
      .where(and(
        eq(schedulingAvailabilityExceptions.professional_id, professionalId),
        eq(schedulingAvailabilityExceptions.tenant_id, tenantId),
      )),
  ]);

  return {
    weekly: weekly.sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)),
    exceptions: exceptions.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface WeeklyRuleArgs {
  weekday:   number;
  startTime: string;
  endTime:   string;
}

/** Substitui a grade semanal inteira do profissional (em transação). */
export async function replaceWeeklyGrid(
  professionalId: string, tenantId: string, rules: WeeklyRuleArgs[], db: DrizzleDB = _db,
) {
  await getProfessionalOrThrow(professionalId, tenantId, db);
  for (const rule of rules) validateWeeklyRule(rule);

  return db.transaction(async (tx) => {
    await tx.delete(schedulingAvailabilityRules)
      .where(and(
        eq(schedulingAvailabilityRules.professional_id, professionalId),
        eq(schedulingAvailabilityRules.tenant_id, tenantId),
      ));

    const inserted = [];
    for (const rule of rules) {
      const [row] = await tx.insert(schedulingAvailabilityRules).values({
        tenant_id:       tenantId,
        professional_id: professionalId,
        weekday:         rule.weekday,
        start_time:      rule.startTime,
        end_time:        rule.endTime,
      }).returning();
      inserted.push(row);
    }
    return inserted;
  });
}

export interface AddExceptionArgs {
  professionalId: string;
  tenantId:       string;
  date:           string;
  kind:           'block' | 'open';
  startTime?:     string | null;
  endTime?:       string | null;
  note?:          string | null;
}

export async function addException(args: AddExceptionArgs, db: DrizzleDB = _db) {
  await getProfessionalOrThrow(args.professionalId, args.tenantId, db);
  if (!isValidDateISO(args.date)) {
    throw new SchedulingDomainError('invalid_date_format', { value: args.date });
  }
  validateException({
    kind:      args.kind,
    startTime: args.startTime ?? null,
    endTime:   args.endTime ?? null,
  });

  const [row] = await db.insert(schedulingAvailabilityExceptions).values({
    tenant_id:       args.tenantId,
    professional_id: args.professionalId,
    date:            args.date,
    kind:            args.kind,
    start_time:      args.startTime ?? null,
    end_time:        args.endTime ?? null,
    note:            args.note ?? null,
  }).returning();
  return row;
}

export async function removeException(id: string, tenantId: string, db: DrizzleDB = _db): Promise<void> {
  const [existing] = await db.select({
    id: schedulingAvailabilityExceptions.id,
    professional_id: schedulingAvailabilityExceptions.professional_id,
  }).from(schedulingAvailabilityExceptions)
    .where(and(
      eq(schedulingAvailabilityExceptions.id, id),
      eq(schedulingAvailabilityExceptions.tenant_id, tenantId),
    ));
  if (!existing) throw new SchedulingDomainError('exception_not_found', { id });

  await db.delete(schedulingAvailabilityExceptions)
    .where(eq(schedulingAvailabilityExceptions.id, id));
}

/** Profissional dono da exceção — usado pelo recorte de agenda na rota. */
export async function getExceptionProfessionalId(id: string, tenantId: string, db: DrizzleDB = _db): Promise<string> {
  const [row] = await db.select({ professional_id: schedulingAvailabilityExceptions.professional_id })
    .from(schedulingAvailabilityExceptions)
    .where(and(
      eq(schedulingAvailabilityExceptions.id, id),
      eq(schedulingAvailabilityExceptions.tenant_id, tenantId),
    ));
  if (!row) throw new SchedulingDomainError('exception_not_found', { id });
  return row.professional_id;
}
