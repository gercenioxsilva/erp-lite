// Templates fixos (regra correspondente no README) — conteúdo nunca editável
// pelo tenant. O que É editável por tenant é o `provider_template_id` (Content
// SID do Twilio) depois da aprovação — passo operacional/manual, fora do
// escopo de código; esta camada só grava o resultado.

import { eq, and } from 'drizzle-orm';
import { db as _db } from '../db';
import { whatsappMessageTemplates } from '../db/schema';
import { TEMPLATE_KEYS, isTemplateKey, WhatsAppDomainError, type TemplateKey } from '../domain/whatsapp/whatsappDomain';
import { WHATSAPP_TEMPLATES } from '../lib/whatsappTemplateContent';

export type DrizzleDB = typeof _db;
export type WhatsAppMessageTemplate = typeof whatsappMessageTemplates.$inferSelect;

export interface TemplateView {
  template_key: TemplateKey;
  variables: string[];
  body_preview: string;
  provider_template_id: string | null;
  status: 'pending_approval' | 'approved' | 'rejected';
}

/** Os 5 templates fixos, mesclados com o registro do tenant (se existir) —
 * nunca falha por falta de linha, o default é sempre 'pending_approval'. */
export async function listTemplates(tenantId: string, db: DrizzleDB = _db): Promise<TemplateView[]> {
  const rows = await db.select().from(whatsappMessageTemplates).where(eq(whatsappMessageTemplates.tenant_id, tenantId));
  const byKey = new Map(rows.map(r => [r.template_key, r]));

  return TEMPLATE_KEYS.map(key => {
    const def = WHATSAPP_TEMPLATES[key];
    const row = byKey.get(key);
    return {
      template_key: key,
      variables: def.variables,
      body_preview: def.body,
      provider_template_id: row?.provider_template_id ?? null,
      status: (row?.status as TemplateView['status']) ?? 'pending_approval',
    };
  });
}

/** Registra o Content SID aprovado pro provedor — upsert por (tenant, key).
 * Setar provider_template_id sempre marca status='approved': a UI só oferece
 * esse campo depois que o template já foi de fato aprovado no Twilio. */
export async function upsertTemplateRegistration(
  tenantId: string, templateKey: string, providerTemplateId: string, db: DrizzleDB = _db,
): Promise<WhatsAppMessageTemplate> {
  if (!isTemplateKey(templateKey)) throw new WhatsAppDomainError('invalid_template_key', { templateKey });
  if (!providerTemplateId?.trim()) throw new WhatsAppDomainError('provider_template_id_required');

  const [existing] = await db.select().from(whatsappMessageTemplates)
    .where(and(eq(whatsappMessageTemplates.tenant_id, tenantId), eq(whatsappMessageTemplates.template_key, templateKey)));

  if (existing) {
    const [row] = await db.update(whatsappMessageTemplates)
      .set({ provider_template_id: providerTemplateId, status: 'approved', updated_at: new Date() })
      .where(eq(whatsappMessageTemplates.id, existing.id)).returning();
    return row;
  }

  const [row] = await db.insert(whatsappMessageTemplates).values({
    tenant_id: tenantId, template_key: templateKey,
    provider_template_id: providerTemplateId, status: 'approved',
  }).returning();
  return row;
}
