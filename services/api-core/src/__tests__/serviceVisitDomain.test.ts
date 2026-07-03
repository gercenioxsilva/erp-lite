import { describe, it, expect } from 'vitest';
import {
  assertServiceVisitTransition,
  isRoutingTokenValid,
  canCheckIn,
  canUploadPhoto,
  canCaptureSignature,
  canComplete,
  isValidCPF,
  validateServiceVisitCreate,
  ServiceVisitDomainError,
} from '../domain/serviceVisit/serviceVisitDomain';

describe('serviceVisit state machine', () => {
  it('scheduled → in_progress is valid', () => {
    expect(() => assertServiceVisitTransition('scheduled', 'in_progress')).not.toThrow();
  });

  it('scheduled → no_show is valid', () => {
    expect(() => assertServiceVisitTransition('scheduled', 'no_show')).not.toThrow();
  });

  it('in_progress → completed is valid', () => {
    expect(() => assertServiceVisitTransition('in_progress', 'completed')).not.toThrow();
  });

  it('scheduled → completed throws (must check in first)', () => {
    expect(() => assertServiceVisitTransition('scheduled', 'completed')).toThrow(ServiceVisitDomainError);
  });

  it('completed → any throws (terminal state)', () => {
    expect(() => assertServiceVisitTransition('completed', 'in_progress')).toThrow(ServiceVisitDomainError);
  });
});

describe('isRoutingTokenValid', () => {
  const future = new Date(Date.now() + 60_000);
  const past   = new Date(Date.now() - 60_000);

  it('valid when not expired and status is open', () => {
    expect(isRoutingTokenValid(future, 'scheduled')).toBe(true);
    expect(isRoutingTokenValid(future, 'in_progress')).toBe(true);
  });

  it('invalid when expired', () => {
    expect(isRoutingTokenValid(past, 'scheduled')).toBe(false);
  });

  it('invalid once status is terminal, even if not expired', () => {
    expect(isRoutingTokenValid(future, 'completed')).toBe(false);
    expect(isRoutingTokenValid(future, 'cancelled')).toBe(false);
    expect(isRoutingTokenValid(future, 'no_show')).toBe(false);
  });
});

describe('elegibilidade de ações', () => {
  it('canCheckIn só quando scheduled', () => {
    expect(canCheckIn('scheduled')).toBe(true);
    expect(canCheckIn('in_progress')).toBe(false);
  });

  it('canUploadPhoto e canCaptureSignature só quando in_progress', () => {
    expect(canUploadPhoto('in_progress')).toBe(true);
    expect(canUploadPhoto('scheduled')).toBe(false);
    expect(canCaptureSignature('in_progress')).toBe(true);
    expect(canCaptureSignature('completed')).toBe(false);
  });

  it('canComplete exige in_progress e check-in já feito', () => {
    expect(canComplete('in_progress', true)).toBe(true);
    expect(canComplete('in_progress', false)).toBe(false);
    expect(canComplete('scheduled', true)).toBe(false);
  });
});

describe('isValidCPF', () => {
  it('valida CPFs conhecidos válidos', () => {
    expect(isValidCPF('111.444.777-35')).toBe(true);
    expect(isValidCPF('11144477735')).toBe(true);
  });

  it('rejeita CPF com dígito verificador errado', () => {
    expect(isValidCPF('111.444.777-36')).toBe(false);
  });

  it('rejeita sequência de dígitos repetidos', () => {
    expect(isValidCPF('111.111.111-11')).toBe(false);
  });

  it('rejeita tamanho incorreto', () => {
    expect(isValidCPF('123')).toBe(false);
  });
});

describe('validateServiceVisitCreate', () => {
  it('passa com data futura', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    expect(() => validateServiceVisitCreate(
      { scheduledAt: new Date('2026-07-02T12:00:00Z') }, now,
    )).not.toThrow();
  });

  it('lança service_visit_scheduled_in_past para data passada', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    try {
      validateServiceVisitCreate({ scheduledAt: new Date('2026-06-30T12:00:00Z') }, now);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toMatchObject({ code: 'service_visit_scheduled_in_past' });
    }
  });
});
