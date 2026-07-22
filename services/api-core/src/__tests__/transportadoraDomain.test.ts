import { describe, it, expect } from 'vitest';
import {
  validateTransportadora, normalizeDocument, TransportadoraDomainError,
} from '../domain/transportadora/transportadoraDomain';

const VALID_CNPJ = '11.444.777/0001-61';
const VALID_CPF  = '111.444.777-35';

describe('validateTransportadora', () => {
  it('aceita PJ com CNPJ válido', () => {
    expect(() => validateTransportadora({ name: 'Transportadora Rápida', person_type: 'PJ', document: VALID_CNPJ })).not.toThrow();
  });

  it('aceita PF (autônomo) com CPF válido', () => {
    expect(() => validateTransportadora({ name: 'João Motorista', person_type: 'PF', document: VALID_CPF })).not.toThrow();
  });

  it('aceita sem documento (opcional no cadastro, mesmo padrão de sellers.document)', () => {
    expect(() => validateTransportadora({ name: 'Transportadora Sem Doc', person_type: 'PJ' })).not.toThrow();
  });

  it('rejeita nome vazio', () => {
    expect(() => validateTransportadora({ name: '', person_type: 'PJ' })).toThrow(TransportadoraDomainError);
    expect(() => validateTransportadora({ name: '   ', person_type: 'PJ' })).toThrow(TransportadoraDomainError);
  });

  it('rejeita person_type inválido', () => {
    expect(() => validateTransportadora({ name: 'X', person_type: 'XX' as any })).toThrow(TransportadoraDomainError);
  });

  it('rejeita CNPJ inválido pra PJ', () => {
    expect(() => validateTransportadora({ name: 'X', person_type: 'PJ', document: '00000000000000' })).toThrow(TransportadoraDomainError);
  });

  it('rejeita CPF inválido pra PF', () => {
    expect(() => validateTransportadora({ name: 'X', person_type: 'PF', document: '11111111111' })).toThrow(TransportadoraDomainError);
  });

  it('rejeita um CPF válido cadastrado como PJ (documento do tipo errado)', () => {
    expect(() => validateTransportadora({ name: 'X', person_type: 'PJ', document: VALID_CPF })).toThrow(TransportadoraDomainError);
  });
});

describe('normalizeDocument', () => {
  it('normaliza CNPJ removendo pontuação, mantendo letras (CNPJ alfanumérico)', () => {
    expect(normalizeDocument(VALID_CNPJ, 'PJ')).toBe('11444777000161');
  });

  it('normaliza CPF pra só dígitos', () => {
    expect(normalizeDocument(VALID_CPF, 'PF')).toBe('11144477735');
  });
});
