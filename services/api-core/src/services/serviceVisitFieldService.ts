// Orquestração de I/O — Campos Personalizados de Visita Técnica (migration
// 0088). Mesmo molde de contractFieldService.ts, mas os dois recursos nunca
// se misturam: definições (schema por tenant) são geridas em Minha Empresa →
// Campos da Visita Técnica (admin-only, service_visit_fields:manage);
// valores são preenchidos pelo TÉCNICO no portal dele, no momento da visita
// (diferente de contrato, onde o backoffice preenche no próprio cadastro).

import { eq, and, inArray } from 'drizzle-orm';
import { db as _db } from '../db';
import { serviceVisitFieldDefinitions, serviceVisitFieldValues } from '../db/schema';
import {
  validateFieldDefinitionInput, validateFieldValue, slugifyFieldKey,
  CustomFieldDomainError, type FieldType,
  type FieldDefinitionInput,
} from '../domain/customFields/customFieldDomain';

export type DrizzleDB = typeof _db;
export { CustomFieldDomainError as ServiceVisitFieldDomainError };
export type ServiceVisitFieldDefinition = typeof serviceVisitFieldDefinitions.$inferSelect;

/** Definições ativas do tenant, ordenadas pra renderização do formulário. */
export async function listVisitFieldDefinitions(tenantId: string, db: DrizzleDB = _db): Promise<ServiceVisitFieldDefinition[]> {
  const rows = await db.select().from(serviceVisitFieldDefinitions)
    .where(and(eq(serviceVisitFieldDefinitions.tenant_id, tenantId), eq(serviceVisitFieldDefinitions.is_active, true)));
  return rows.sort((a, b) => a.sort_order - b.sort_order);
}

export async function createVisitFieldDefinition(
  tenantId: string, input: FieldDefinitionInput, db: DrizzleDB = _db,
): Promise<ServiceVisitFieldDefinition> {
  validateFieldDefinitionInput(input);
  const key = slugifyFieldKey(input.label);

  const [existing] = await db.select({ id: serviceVisitFieldDefinitions.id }).from(serviceVisitFieldDefinitions)
    .where(and(eq(serviceVisitFieldDefinitions.tenant_id, tenantId), eq(serviceVisitFieldDefinitions.field_key, key)));
  if (existing) throw new CustomFieldDomainError('field_key_duplicate', { key });

  const [row] = await db.insert(serviceVisitFieldDefinitions).values({
    tenant_id:  tenantId,
    field_key:  key,
    label:      input.label,
    field_type: input.field_type,
    required:   input.required ?? false,
    sort_order: input.sort_order ?? 0,
  }).returning();
  return row;
}

export type VisitFieldDefinitionUpdateInput = Partial<Pick<FieldDefinitionInput, 'label' | 'required' | 'sort_order'>>;

/** Nunca aceita field_type no input — trocar o tipo depois de criado corromperia a semântica dos valores já salvos. */
export async function updateVisitFieldDefinition(
  tenantId: string, id: string, input: VisitFieldDefinitionUpdateInput, db: DrizzleDB = _db,
): Promise<ServiceVisitFieldDefinition> {
  const [current] = await db.select().from(serviceVisitFieldDefinitions)
    .where(and(eq(serviceVisitFieldDefinitions.id, id), eq(serviceVisitFieldDefinitions.tenant_id, tenantId)));
  if (!current) throw new CustomFieldDomainError('field_not_found', { id });

  if (input.label !== undefined && !input.label.trim()) {
    throw new CustomFieldDomainError('field_label_required');
  }

  const [row] = await db.update(serviceVisitFieldDefinitions).set({
    label:      input.label      ?? current.label,
    required:   input.required   ?? current.required,
    sort_order: input.sort_order ?? current.sort_order,
    updated_at: new Date(),
  }).where(eq(serviceVisitFieldDefinitions.id, id)).returning();
  return row;
}

/** Soft-delete (regra 8) — nunca some de visitas já respondidas, só some do formulário de novas visitas. */
export async function deactivateVisitFieldDefinition(tenantId: string, id: string, db: DrizzleDB = _db): Promise<void> {
  const [current] = await db.select({ id: serviceVisitFieldDefinitions.id }).from(serviceVisitFieldDefinitions)
    .where(and(eq(serviceVisitFieldDefinitions.id, id), eq(serviceVisitFieldDefinitions.tenant_id, tenantId)));
  if (!current) throw new CustomFieldDomainError('field_not_found', { id });

  await db.update(serviceVisitFieldDefinitions).set({ is_active: false, updated_at: new Date() })
    .where(eq(serviceVisitFieldDefinitions.id, id));
}

export interface VisitFieldValueView {
  field_definition_id: string;
  field_key:  string;
  label:      string;
  field_type: FieldType;
  required:   boolean;
  value:      string | null;
}

/**
 * Valores de uma visita, com a definição já junto — inclui definições
 * INATIVAS que a visita já tinha valor preenchido (histórico nunca some),
 * mas não inclui definições ativas sem valor nenhum aqui (isso é resolvido
 * por quem chama, cruzando com listVisitFieldDefinitions — mesmo padrão de
 * getFieldValuesForContract).
 */
export async function getFieldValuesForVisit(
  visitId: string, tenantId: string, db: DrizzleDB = _db,
): Promise<VisitFieldValueView[]> {
  const rows = await db.select({
    field_definition_id: serviceVisitFieldValues.field_definition_id,
    field_key:  serviceVisitFieldDefinitions.field_key,
    label:      serviceVisitFieldDefinitions.label,
    field_type: serviceVisitFieldDefinitions.field_type,
    required:   serviceVisitFieldDefinitions.required,
    value:      serviceVisitFieldValues.value,
  }).from(serviceVisitFieldValues)
    .innerJoin(serviceVisitFieldDefinitions, eq(serviceVisitFieldDefinitions.id, serviceVisitFieldValues.field_definition_id))
    .where(and(eq(serviceVisitFieldValues.service_visit_id, visitId), eq(serviceVisitFieldValues.tenant_id, tenantId)));

  return rows.map(r => ({ ...r, field_type: r.field_type as FieldType }));
}

export interface VisitFieldValueInput {
  field_definition_id: string;
  value: string | null;
}

/**
 * Substitui os valores de campos personalizados de uma visita — valida cada
 * valor conforme o tipo da respectiva definição (nunca confia no que o
 * cliente HTTP mandou sem checar contra o schema do tenant). Chamado por
 * completeVisit() em serviceVisitService.ts ANTES de marcar a visita como
 * concluída — um campo obrigatório sem resposta bloqueia a conclusão com um
 * erro de domínio claro, nunca deixa a visita "meio completa".
 */
export async function setFieldValuesForVisit(
  visitId: string, tenantId: string, values: VisitFieldValueInput[], db: DrizzleDB = _db,
): Promise<void> {
  if (!values.length) return;

  const defIds = values.map(v => v.field_definition_id);
  const defs = await db.select().from(serviceVisitFieldDefinitions)
    .where(and(eq(serviceVisitFieldDefinitions.tenant_id, tenantId), inArray(serviceVisitFieldDefinitions.id, defIds)));
  const defsById = new Map(defs.map(d => [d.id, d]));

  const normalized = values.map(v => {
    const def = defsById.get(v.field_definition_id);
    if (!def) throw new CustomFieldDomainError('field_not_found', { id: v.field_definition_id });
    const normalizedValue = validateFieldValue(def.field_type as FieldType, def.required, v.value);
    return { field_definition_id: v.field_definition_id, value: normalizedValue };
  });

  await db.delete(serviceVisitFieldValues).where(and(
    eq(serviceVisitFieldValues.service_visit_id, visitId),
    inArray(serviceVisitFieldValues.field_definition_id, defIds),
  ));

  const toInsert = normalized.filter(v => v.value !== null);
  if (toInsert.length) {
    await db.insert(serviceVisitFieldValues).values(toInsert.map(v => ({
      service_visit_id: visitId, tenant_id: tenantId,
      field_definition_id: v.field_definition_id, value: v.value,
    })));
  }
}
