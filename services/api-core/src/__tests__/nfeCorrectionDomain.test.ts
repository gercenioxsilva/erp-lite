import { describe, it, expect } from 'vitest';
import {
  validateCorrectionText, canIssueCorrection, nextSequence, NfeCorrectionDomainError,
  MIN_CORRECTION_TEXT_LENGTH, MAX_CORRECTION_TEXT_LENGTH,
} from '../domain/nfeCorrection/nfeCorrectionDomain';

describe('validateCorrectionText', () => {
  it('aceita texto dentro do intervalo permitido pela SEFAZ', () => {
    expect(() => validateCorrectionText('a'.repeat(MIN_CORRECTION_TEXT_LENGTH))).not.toThrow();
    expect(() => validateCorrectionText('a'.repeat(MAX_CORRECTION_TEXT_LENGTH))).not.toThrow();
  });

  it('rejeita texto abaixo do mínimo', () => {
    expect(() => validateCorrectionText('corrige endereço')).not.toThrow(); // 17 chars, ok
    expect(() => validateCorrectionText('curto')).toThrow(NfeCorrectionDomainError);
  });

  it('rejeita texto acima do máximo', () => {
    expect(() => validateCorrectionText('a'.repeat(MAX_CORRECTION_TEXT_LENGTH + 1))).toThrow(NfeCorrectionDomainError);
  });

  it('rejeita texto ausente', () => {
    expect(() => validateCorrectionText(undefined)).toThrow(NfeCorrectionDomainError);
  });
});

describe('canIssueCorrection', () => {
  it('só nota autorizada admite CC-e', () => {
    expect(canIssueCorrection('authorized')).toBe(true);
    expect(canIssueCorrection('cancelled')).toBe(false);
    expect(canIssueCorrection('rejected')).toBe(false);
    expect(canIssueCorrection('processing')).toBe(false);
    expect(canIssueCorrection(null)).toBe(false);
  });
});

describe('nextSequence', () => {
  it('começa em 1 quando não há CC-e anterior', () => {
    expect(nextSequence([])).toBe(1);
  });

  it('é sempre a maior sequência já usada + 1, mesmo fora de ordem', () => {
    expect(nextSequence([1, 2, 3])).toBe(4);
    expect(nextSequence([3, 1, 2])).toBe(4);
  });

  it('nunca reaproveita um número, mesmo que a CC-e correspondente tenha sido rejeitada', () => {
    // sequencia 2 existe mesmo rejeitada — não filtra por status, é responsabilidade do chamador
    expect(nextSequence([1, 2])).toBe(3);
  });
});
