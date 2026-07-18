// Orquestração de I/O — Campos Personalizados de Contrato (migration 0072).
// Definições (schema por tenant) e valores (por contrato) são dois recursos
// distintos: definições são gerenciadas em Contratos → Campos Personalizados;
// valores são preenchidos/lidos junto com o próprio contrato.

import { eq, and, inArray } from 'drizzle-orm';
import { db as _db } from '../db';
import { contractFieldDefinitions, contractFieldValues } from '../db/schema';
import {
  validateFieldDefinitionInput, validateFieldValue, slugifyFieldKey,
  ContractFieldDomainError, type FieldType,
  type FieldDefinitionInput,
} from '../domain/contractField/contractFieldDomain';

export type DrizzleDB = typeof _db;
export { ContractFieldDomainError };
export type FieldDefinition = typeof contractFieldDefinitions.$inferSelect;

/** Definições ativas do tenant, ordenadas pra renderização do formulário. */
export async function listFieldDefinitions(tenantId: string, db: DrizzleDB = _db): Promise<FieldDefinition[]> {
  const rows = await db.select().from(contractFieldDefinitions)
    .where(and(eq(contractFieldDefinitions.tenant_id, tenantId), eq(contractFieldDefinitions.is_active, true)));
  return rows.sort((a, b) => a.sort_order - b.sort_order);
}

export async function createFieldDefinition(
  tenantId: string, input: FieldDefinitionInput, db: DrizzleDB = _db,
): Promise<FieldDefinition> {
  validateFieldDefinitionInput(input);
  const key = slugifyFieldKey(input.label);

  const [existing] = await db.select({ id: contractFieldDefinitions.id }).from(contractFieldDefinitions)
    .where(and(eq(contractFieldDefinitions.tenant_id, tenantId), eq(contractFieldDefinitions.field_key, key)));
  if (existing) throw new ContractFieldDomainError('field_key_duplicate', { key });

  const [row] = await db.insert(contractFieldDefinitions).values({
    tenant_id:  tenantId,
    field_key:  key,
    label:      input.label,
    field_type: input.field_type,
    required:   input.required ?? false,
    sort_order: input.sort_order ?? 0,
  }).returning();
  return row;
}

export type FieldDefinitionUpdateInput = Partial<Pick<FieldDefinitionInput, 'label' | 'required' | 'sort_order'>>;

/** Nunca aceita field_type no input — trocar o tipo depois de criado corromperia a semântica dos valores já salvos. */
export async function updateFieldDefinition(
  tenantId: string, id: string, input: FieldDefinitionUpdateInput, db: DrizzleDB = _db,
): Promise<FieldDefinition> {
  const [current] = await db.select().from(contractFieldDefinitions)
    .where(and(eq(contractFieldDefinitions.id, id), eq(contractFieldDefinitions.tenant_id, tenantId)));
  if (!current) throw new ContractFieldDomainError('field_not_found', { id });

  if (input.label !== undefined && !input.label.trim()) {
    throw new ContractFieldDomainError('field_label_required');
  }

  const [row] = await db.update(contractFieldDefinitions).set({
    label:      input.label      ?? current.label,
    required:   input.required   ?? current.required,
    sort_order: input.sort_order ?? current.sort_order,
    updated_at: new Date(),
  }).where(eq(contractFieldDefinitions.id, id)).returning();
  return row;
}

/** Soft-delete (regra 8) — nunca some dos contratos já criados, só some do formulário de novos/edição. */
export async function deactivateFieldDefinition(tenantId: string, id: string, db: DrizzleDB = _db): Promise<void> {
  const [current] = await db.select({ id: contractFieldDefinitions.id }).from(contractFieldDefinitions)
    .where(and(eq(contractFieldDefinitions.id, id), eq(contractFieldDefinitions.tenant_id, tenantId)));
  if (!current) throw new ContractFieldDomainError('field_not_found', { id });

  await db.update(contractFieldDefinitions).set({ is_active: false, updated_at: new Date() })
    .where(eq(contractFieldDefinitions.id, id));
}

export interface ContractFieldValueView {
  field_definition_id: string;
  field_key:  string;
  label:      string;
  field_type: FieldType;
  required:   boolean;
  value:      string | null;
}

/**
 * Valores de um contrato, com a definição já junto — inclui definições
 * INATIVAS que o contrato já tinha valor preenchido (histórico nunca some),
 * mas não inclui definições ativas sem valor nenhum aqui (isso é resolvido
 * pelo formulário do frontend, que já tem a lista completa via
 * listFieldDefinitions e cruza com o que vier daqui).
 */
export async function getFieldValuesForContract(
  contractId: string, tenantId: string, db: DrizzleDB = _db,
): Promise<ContractFieldValueView[]> {
  const rows = await db.select({
    field_definition_id: contractFieldValues.field_definition_id,
    field_key:  contractFieldDefinitions.field_key,
    label:      contractFieldDefinitions.label,
    field_type: contractFieldDefinitions.field_type,
    required:   contractFieldDefinitions.required,
    value:      contractFieldValues.value,
  }).from(contractFieldValues)
    .innerJoin(contractFieldDefinitions, eq(contractFieldDefinitions.id, contractFieldValues.field_definition_id))
    .where(and(eq(contractFieldValues.contract_id, contractId), eq(contractFieldValues.tenant_id, tenantId)));

  return rows.map(r => ({ ...r, field_type: r.field_type as FieldType }));
}

export interface FieldValueInput {
  field_definition_id: string;
  value: string | null;
}

/**
 * Substitui os valores de campos personalizados de um contrato — valida cada
 * valor conforme o tipo da respectiva definição (nunca confia no que o
 * cliente HTTP mandou sem checar contra o schema do tenant). Chamado dentro
 * da mesma transação de criação/edição do contrato, pelo chamador.
 */
export async function setFieldValuesForContract(
  contractId: string, tenantId: string, values: FieldValueInput[], db: DrizzleDB = _db,
): Promise<void> {
  if (!values.length) return;

  const defIds = values.map(v => v.field_definition_id);
  const defs = await db.select().from(contractFieldDefinitions)
    .where(and(eq(contractFieldDefinitions.tenant_id, tenantId), inArray(contractFieldDefinitions.id, defIds)));
  const defsById = new Map(defs.map(d => [d.id, d]));

  const normalized = values.map(v => {
    const def = defsById.get(v.field_definition_id);
    if (!def) throw new ContractFieldDomainError('field_not_found', { id: v.field_definition_id });
    const normalizedValue = validateFieldValue(def.field_type as FieldType, def.required, v.value);
    return { field_definition_id: v.field_definition_id, value: normalizedValue };
  });

  await db.delete(contractFieldValues).where(and(
    eq(contractFieldValues.contract_id, contractId),
    inArray(contractFieldValues.field_definition_id, defIds),
  ));

  const toInsert = normalized.filter(v => v.value !== null);
  if (toInsert.length) {
    await db.insert(contractFieldValues).values(toInsert.map(v => ({
      contract_id: contractId, tenant_id: tenantId,
      field_definition_id: v.field_definition_id, value: v.value,
    })));
  }
}
