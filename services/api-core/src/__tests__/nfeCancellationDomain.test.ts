import { describe, it, expect } from 'vitest';
import {
  validateJustificativa, requiresFiscalCancellation, NfeCancellationDomainError,
  MIN_JUSTIFICATIVA_LENGTH, MAX_JUSTIFICATIVA_LENGTH,
} from '../domain/nfeCancellation/nfeCancellationDomain';

describe('validateJustificativa', () => {
  it('aceita texto com o tamanho mínimo exigido pela SEFAZ', () => {
    expect(() => validateJustificativa('a'.repeat(MIN_JUSTIFICATIVA_LENGTH))).not.toThrow();
  });

  it('rejeita texto abaixo do mínimo', () => {
    expect(() => validateJustificativa('curto demais')).toThrow(NfeCancellationDomainError);
  });

  it('rejeita ausência de justificativa', () => {
    expect(() => validateJustificativa(undefined)).toThrow(NfeCancellationDomainError);
    expect(() => validateJustificativa('')).toThrow(NfeCancellationDomainError);
  });

  it('rejeita texto acima do máximo', () => {
    expect(() => validateJustificativa('a'.repeat(MAX_JUSTIFICATIVA_LENGTH + 1))).toThrow(NfeCancellationDomainError);
  });

  it('ignora espaços nas bordas ao medir o tamanho', () => {
    const padded = ' '.repeat(5) + 'a'.repeat(MIN_JUSTIFICATIVA_LENGTH) + ' '.repeat(5);
    expect(() => validateJustificativa(padded)).not.toThrow();
  });
});

describe('requiresFiscalCancellation', () => {
  it('só nota autorizada precisa de cancelamento junto à SEFAZ', () => {
    expect(requiresFiscalCancellation('authorized')).toBe(true);
  });

  it('draft/rejected/processing nunca chegaram a ser autorizados — cancelamento é só local', () => {
    expect(requiresFiscalCancellation('draft')).toBe(false);
    expect(requiresFiscalCancellation('rejected')).toBe(false);
    expect(requiresFiscalCancellation('processing')).toBe(false);
    expect(requiresFiscalCancellation(null)).toBe(false);
  });
});
