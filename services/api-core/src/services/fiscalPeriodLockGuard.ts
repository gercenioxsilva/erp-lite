// Guard ÚNICO da trava de competência — módulo LEVE (só db+schema) para os
// serviços de escrita (apuração, consolidação, conciliação, posting contábil)
// importarem sem ciclo com o fiscalClosingService (que também o re-exporta).
// companyId null (fatos tenant-level) → bloqueia se QUALQUER company do
// tenant estiver travada na competência (decisão conservadora do plano).

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { fiscalPeriodLocks } from '../db/schema';

export type DrizzleDB = typeof _db;

export class FiscalLockError extends Error {
  constructor(public code: string, public payload: Record<string, unknown> = {}) {
    super(code);
    this.name = 'FiscalLockError';
  }
}

export async function assertCompetenciaAberta(
  tenantId: string, companyId: string | null, competencia: string, db: DrizzleDB = _db,
): Promise<void> {
  const conditions = [
    eq(fiscalPeriodLocks.tenant_id, tenantId),
    eq(fiscalPeriodLocks.competencia, competencia),
    eq(fiscalPeriodLocks.status, 'locked'),
  ];
  if (companyId) conditions.push(eq(fiscalPeriodLocks.company_id, companyId));
  const [lock] = await db.select({ id: fiscalPeriodLocks.id }).from(fiscalPeriodLocks)
    .where(and(...conditions)).limit(1);
  if (lock) throw new FiscalLockError('competencia_travada', { competencia, companyId });
}
