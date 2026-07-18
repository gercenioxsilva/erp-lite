import { describe, it, expect } from 'vitest';
import {
  slugifyFieldKey, validateFieldDefinitionInput, validateFieldValue, formatFieldValueForDisplay,
  isValidFieldType, ContractFieldDomainError,
} from '../contractFieldDomain';

describe('slugifyFieldKey', () => {
  it('deriva uma chave minúscula, sem acento, com underscore', () => {
    expect(slugifyFieldKey('Valor do Contrato')).toBe('valor_do_contrato');
  });

  it('remove acentuação (ç, ã, é...)', () => {
    expect(slugifyFieldKey('Condição de Pagamento')).toBe('condicao_de_pagamento');
  });

  it('remove pontuação/símbolos não alfanuméricos', () => {
    expect(slugifyFieldKey('Data de Assinatura (opcional)!')).toBe('data_de_assinatura_opcional');
  });
});

describe('isValidFieldType', () => {
  it.each(['text', 'decimal', 'integer', 'date', 'boolean'])('aceita %s', (t) => {
    expect(isValidFieldType(t)).toBe(true);
  });
  it('rejeita um tipo desconhecido', () => {
    expect(isValidFieldType('currency')).toBe(false);
  });
});

describe('validateFieldDefinitionInput', () => {
  it('aceita um input válido', () => {
    expect(() => validateFieldDefinitionInput({ label: 'Valor do Contrato', field_type: 'decimal' })).not.toThrow();
  });

  it('rejeita label vazio', () => {
    expect(() => validateFieldDefinitionInput({ label: '  ', field_type: 'text' }))
      .toThrow(ContractFieldDomainError);
  });

  it('rejeita field_type inválido', () => {
    expect(() => validateFieldDefinitionInput({ label: 'X', field_type: 'currency' }))
      .toThrow(ContractFieldDomainError);
  });
});

describe('validateFieldValue', () => {
  it('normaliza decimal aceitando vírgula como separador', () => {
    expect(validateFieldValue('decimal', false, '1234,56')).toBe('1234.56');
  });

  it('rejeita decimal inválido', () => {
    expect(() => validateFieldValue('decimal', false, 'abc')).toThrow(ContractFieldDomainError);
  });

  it('rejeita integer com casas decimais', () => {
    expect(() => validateFieldValue('integer', false, '3.5')).toThrow(ContractFieldDomainError);
  });

  it('aceita integer válido', () => {
    expect(validateFieldValue('integer', false, '12')).toBe('12');
  });

  it('rejeita date fora do formato ISO', () => {
    expect(() => validateFieldValue('date', false, '25/12/2026')).toThrow(ContractFieldDomainError);
  });

  it('aceita date ISO', () => {
    expect(validateFieldValue('date', false, '2026-12-25')).toBe('2026-12-25');
  });

  it('rejeita boolean fora de true/false', () => {
    expect(() => validateFieldValue('boolean', false, 'sim')).toThrow(ContractFieldDomainError);
  });

  it('text passa direto, sem transformação', () => {
    expect(validateFieldValue('text', false, '  Observação livre  ')).toBe('Observação livre');
  });

  it('valor vazio + not required → null', () => {
    expect(validateFieldValue('text', false, '')).toBeNull();
    expect(validateFieldValue('text', false, null)).toBeNull();
  });

  it('valor vazio + required → lança erro', () => {
    expect(() => validateFieldValue('text', true, '')).toThrow(ContractFieldDomainError);
  });
});

describe('formatFieldValueForDisplay', () => {
  it('formata decimal em pt-BR', () => {
    expect(formatFieldValueForDisplay('decimal', '1234.5')).toBe('1.234,50');
  });

  it('formata integer em pt-BR', () => {
    expect(formatFieldValueForDisplay('integer', '1234')).toBe('1.234');
  });

  it('formata date em pt-BR', () => {
    expect(formatFieldValueForDisplay('date', '2026-12-25')).toBe('25/12/2026');
  });

  it('formata boolean como Sim/Não', () => {
    expect(formatFieldValueForDisplay('boolean', 'true')).toBe('Sim');
    expect(formatFieldValueForDisplay('boolean', 'false')).toBe('Não');
  });

  it('valor nulo/vazio vira travessão', () => {
    expect(formatFieldValueForDisplay('text', null)).toBe('—');
    expect(formatFieldValueForDisplay('text', '')).toBe('—');
  });
});
