// Flag genérica de módulo opcional habilitado por tenant. Reaproveitável por
// qualquer módulo de nicho futuro — 'service_orders' é só o primeiro consumidor.
// Autoridade fica no backend: rotas gated chamam isModuleEnabled() via o hook
// requireModule (src/lib/requireModule.ts), nunca confiam em esconder um item
// de menu no frontend como controle de acesso.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { tenantModules } from '../db/schema';

export type DrizzleDB = typeof _db;

export const MODULE_KEYS = ['service_orders', 'multi_empresa', 'pos', 'mercadolivre', 'sales_pipeline', 'hr', 'scheduling'] as const;
export type ModuleKey = typeof MODULE_KEYS[number];

export async function isModuleEnabled(tenantId: string, moduleKey: ModuleKey, db: DrizzleDB = _db): Promise<boolean> {
  const [row] = await db.select({ enabled: tenantModules.enabled }).from(tenantModules)
    .where(and(eq(tenantModules.tenant_id, tenantId), eq(tenantModules.module_key, moduleKey)));
  return row?.enabled ?? false;
}

export async function listEnabledModules(tenantId: string, db: DrizzleDB = _db): Promise<ModuleKey[]> {
  const rows = await db.select({ module_key: tenantModules.module_key, enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(eq(tenantModules.tenant_id, tenantId));
  return rows.filter(r => r.enabled).map(r => r.module_key as ModuleKey);
}

export async function setModuleEnabled(
  tenantId: string, moduleKey: ModuleKey, enabled: boolean, userId: string | null, db: DrizzleDB = _db,
) {
  const [existing] = await db.select({ id: tenantModules.id }).from(tenantModules)
    .where(and(eq(tenantModules.tenant_id, tenantId), eq(tenantModules.module_key, moduleKey)));

  if (existing) {
    await db.update(tenantModules).set({
      enabled,
      enabled_at: enabled ? new Date() : null,
      enabled_by: enabled ? userId : null,
    }).where(eq(tenantModules.id, existing.id));
    return;
  }

  await db.insert(tenantModules).values({
    tenant_id:  tenantId,
    module_key: moduleKey,
    enabled,
    enabled_at: enabled ? new Date() : null,
    enabled_by: enabled ? userId : null,
  });
}
