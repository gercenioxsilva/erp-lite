// Domínio de Campos Personalizados de Contrato (migration 0072) — puro, sem
// I/O. Cada tenant define seu próprio schema de campos (chave/valor tipado),
// aplicado a todo contrato criado depois — renderizado dinamicamente na tela
// de configuração do contrato e no documento impresso/enviado por e-mail.

export class ContractFieldDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'ContractFieldDomainError';
  }
}

export const FIELD_TYPES = ['text', 'decimal', 'integer', 'date', 'boolean'] as const;
export type FieldType = typeof FIELD_TYPES[number];

export function isValidFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Deriva a chave (slug) do campo a partir do label — minúsculo, sem acento,
 * espaços viram '_'. Chamada só na CRIAÇÃO: a chave nunca muda depois, mesmo
 * que o label seja editado (renomear não pode corromper valores já salvos
 * nem exigir migração de dados).
 */
export function slugifyFieldKey(label: string): string {
  const slug = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos (marcas diacríticas combinadas)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.slice(0, 60);
}

export interface FieldDefinitionInput {
  label: string;
  field_type: string;
  required?: boolean;
  sort_order?: number;
}

/** Valida o cadastro de uma nova definição de campo — nunca a edição do field_type depois. */
export function validateFieldDefinitionInput(input: FieldDefinitionInput): void {
  if (!input.label?.trim()) {
    throw new ContractFieldDomainError('field_label_required');
  }
  if (!isValidFieldType(input.field_type)) {
    throw new ContractFieldDomainError('field_type_invalid', { field_type: input.field_type, allowed: FIELD_TYPES });
  }
  const key = slugifyFieldKey(input.label);
  if (!key) {
    throw new ContractFieldDomainError('field_label_invalid', { label: input.label });
  }
}

/**
 * Valida e normaliza um valor recebido pra um campo, conforme o tipo
 * declarado na definição. Nunca reinterpreta o tipo por conta própria — o
 * field_type já resolvido é sempre a fonte da verdade.
 */
export function validateFieldValue(fieldType: FieldType, required: boolean, rawValue: string | null | undefined): string | null {
  const value = rawValue?.trim() ?? '';

  if (!value) {
    if (required) throw new ContractFieldDomainError('field_value_required');
    return null;
  }

  switch (fieldType) {
    case 'decimal': {
      const n = Number(value.replace(',', '.'));
      if (!Number.isFinite(n)) throw new ContractFieldDomainError('field_value_invalid_decimal', { value });
      return String(n);
    }
    case 'integer': {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new ContractFieldDomainError('field_value_invalid_integer', { value });
      return String(n);
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ContractFieldDomainError('field_value_invalid_date', { value });
      return value;
    }
    case 'boolean': {
      if (value !== 'true' && value !== 'false') throw new ContractFieldDomainError('field_value_invalid_boolean', { value });
      return value;
    }
    case 'text':
    default:
      return value;
  }
}

/** Formatação pt-BR pra exibição/impressão — nunca usada pra validação/persistência. */
export function formatFieldValueForDisplay(fieldType: FieldType, value: string | null): string {
  if (value == null || value === '') return '—';
  switch (fieldType) {
    case 'decimal':
      return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'integer':
      return Number(value).toLocaleString('pt-BR');
    case 'date':
      return new Date(value + 'T00:00:00').toLocaleDateString('pt-BR');
    case 'boolean':
      return value === 'true' ? 'Sim' : 'Não';
    case 'text':
    default:
      return value;
  }
}
