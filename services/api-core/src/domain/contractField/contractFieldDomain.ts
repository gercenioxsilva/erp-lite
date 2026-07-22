// Campos Personalizados de Contrato (migration 0072) — este arquivo virou um
// shim: toda a lógica pura (validação/formatação por tipo, slug de chave) foi
// extraída pra domain/customFields/customFieldDomain.ts, reaproveitada
// também pelos Campos Personalizados de Visita Técnica (migration 0088).
// Reexporta com os MESMOS nomes de sempre — `ContractFieldDomainError`
// continua sendo literalmente a mesma classe (só um alias de export), então
// `instanceof ContractFieldDomainError` em contractFieldService.ts/
// routes/contractFields.ts continua funcionando sem nenhuma mudança.

export {
  FIELD_TYPES,
  type FieldType,
  isValidFieldType,
  slugifyFieldKey,
  type FieldDefinitionInput,
  validateFieldDefinitionInput,
  validateFieldValue,
  formatFieldValueForDisplay,
  CustomFieldDomainError as ContractFieldDomainError,
} from '../customFields/customFieldDomain';
