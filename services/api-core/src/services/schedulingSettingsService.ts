// Application Service — Configuração do Agendamento (1 linha por tenant).
// Seed-on-read idempotente (mesmo padrão de listStages do funil): a primeira
// leitura cria a linha com os defaults do design (auto-agendamento desligado,
// 12h de antecedência, fuso America/Sao_Paulo).

import { eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { schedulingSettings } from '../db/schema';
import { SchedulingDomainError, validateSettingsPatch } from '../domain/scheduling/schedulingDomain';

export type DrizzleDB = typeof _db;
export { SchedulingDomainError };

export async function getOrCreateSettings(tenantId: string, db: DrizzleDB = _db) {
  const [existing] = await db.select().from(schedulingSettings)
    .where(eq(schedulingSettings.tenant_id, tenantId));
  if (existing) return existing;

  try {
    const [created] = await db.insert(schedulingSettings)
      .values({ tenant_id: tenantId }).returning();
    return created;
  } catch (err: any) {
    // Corrida benigna entre duas primeiras leituras: o UNIQUE(tenant_id)
    // derruba o segundo insert; a linha do vencedor serve.
    if (err.code === '23505') {
      const [row] = await db.select().from(schedulingSettings)
        .where(eq(schedulingSettings.tenant_id, tenantId));
      return row;
    }
    throw err;
  }
}

export interface UpdateSettingsArgs {
  businessName?:       string | null;
  businessType?:       string | null;
  allowSelfBooking?:   boolean;
  minAdvanceHours?:    number;
  cancelWindowHours?:  number;
  timezone?:           string;
  onboardingComplete?: boolean;
}

export async function updateSettings(tenantId: string, args: UpdateSettingsArgs, db: DrizzleDB = _db) {
  validateSettingsPatch({
    minAdvanceHours:   args.minAdvanceHours,
    cancelWindowHours: args.cancelWindowHours,
    timezone:          args.timezone,
  });

  await getOrCreateSettings(tenantId, db);

  const patch: Record<string, unknown> = { updated_at: new Date() };
  if (args.businessName       !== undefined) patch.business_name       = args.businessName;
  if (args.businessType       !== undefined) patch.business_type       = args.businessType;
  if (args.allowSelfBooking   !== undefined) patch.allow_self_booking  = args.allowSelfBooking;
  if (args.minAdvanceHours    !== undefined) patch.min_advance_hours   = args.minAdvanceHours;
  if (args.cancelWindowHours  !== undefined) patch.cancel_window_hours = args.cancelWindowHours;
  if (args.timezone           !== undefined) patch.timezone            = args.timezone;
  if (args.onboardingComplete !== undefined) patch.onboarding_complete = args.onboardingComplete;

  const [updated] = await db.update(schedulingSettings).set(patch)
    .where(eq(schedulingSettings.tenant_id, tenantId)).returning();
  return updated;
}
