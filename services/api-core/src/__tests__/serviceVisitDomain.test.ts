import { describe, it, expect } from 'vitest';
import {
  assertServiceVisitTransition,
  isRoutingTokenValid,
  canCheckIn,
  canUploadPhoto,
  canCaptureSignature,
  canComplete,
  canRescheduleVisit,
  canCancelVisit,
  isValidCPF,
  validateServiceVisitCreate,
  visitTimeRange,
  visitRangesOverlap,
  visitConflictsWith,
  findVisitConflict,
  isBlockingVisitStatus,
  DEFAULT_VISIT_DURATION_MINUTES,
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

  it('canRescheduleVisit só quando scheduled — depois de check-in a visita já está acontecendo', () => {
    expect(canRescheduleVisit('scheduled')).toBe(true);
    expect(canRescheduleVisit('in_progress')).toBe(false);
    expect(canRescheduleVisit('completed')).toBe(false);
    expect(canRescheduleVisit('cancelled')).toBe(false);
    expect(canRescheduleVisit('no_show')).toBe(false);
  });

  it('canCancelVisit em scheduled ou in_progress, nunca em estado terminal', () => {
    expect(canCancelVisit('scheduled')).toBe(true);
    expect(canCancelVisit('in_progress')).toBe(true);
    expect(canCancelVisit('completed')).toBe(false);
    expect(canCancelVisit('cancelled')).toBe(false);
    expect(canCancelVisit('no_show')).toBe(false);
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

describe('agenda do técnico — conflito de horário (regra 78)', () => {
  it('DEFAULT_VISIT_DURATION_MINUTES é 60', () => {
    expect(DEFAULT_VISIT_DURATION_MINUTES).toBe(60);
  });

  it('visitTimeRange soma a duração em minutos ao início', () => {
    const range = visitTimeRange(new Date('2026-07-20T13:00:00Z'), 90);
    expect(range.start.toISOString()).toBe('2026-07-20T13:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-20T14:30:00.000Z');
  });

  it('isBlockingVisitStatus só scheduled/in_progress seguram horário', () => {
    expect(isBlockingVisitStatus('scheduled')).toBe(true);
    expect(isBlockingVisitStatus('in_progress')).toBe(true);
    expect(isBlockingVisitStatus('completed')).toBe(false);
    expect(isBlockingVisitStatus('cancelled')).toBe(false);
    expect(isBlockingVisitStatus('no_show')).toBe(false);
  });

  describe('visitRangesOverlap — intervalo meio-aberto [start, end)', () => {
    it('sobreposição parcial conflita', () => {
      const a = visitTimeRange(new Date('2026-07-20T09:00:00Z'), 60); // 09:00–10:00
      const b = visitTimeRange(new Date('2026-07-20T09:30:00Z'), 60); // 09:30–10:30
      expect(visitRangesOverlap(a, b)).toBe(true);
    });

    it('terminar às 10:00 não conflita com começar às 10:00 (meio-aberto)', () => {
      const a = visitTimeRange(new Date('2026-07-20T09:00:00Z'), 60); // 09:00–10:00
      const b = visitTimeRange(new Date('2026-07-20T10:00:00Z'), 60); // 10:00–11:00
      expect(visitRangesOverlap(a, b)).toBe(false);
    });

    it('intervalos totalmente separados não conflitam', () => {
      const a = visitTimeRange(new Date('2026-07-20T09:00:00Z'), 30);
      const b = visitTimeRange(new Date('2026-07-20T14:00:00Z'), 30);
      expect(visitRangesOverlap(a, b)).toBe(false);
    });
  });

  describe('visitConflictsWith', () => {
    const candidate = { technicianId: 'tech-1', range: visitTimeRange(new Date('2026-07-20T09:00:00Z'), 60) };

    it('mesmo técnico + horário sobreposto + status scheduled conflita', () => {
      const existing = {
        technicianId: 'tech-1',
        range: visitTimeRange(new Date('2026-07-20T09:30:00Z'), 30),
        status: 'scheduled' as const,
      };
      expect(visitConflictsWith(candidate, existing)).toBe(true);
    });

    it('técnico diferente nunca conflita, mesmo com horário idêntico', () => {
      const existing = {
        technicianId: 'tech-2',
        range: visitTimeRange(new Date('2026-07-20T09:00:00Z'), 60),
        status: 'scheduled' as const,
      };
      expect(visitConflictsWith(candidate, existing)).toBe(false);
    });

    it('status terminal (cancelled/completed/no_show) libera o horário', () => {
      for (const status of ['cancelled', 'completed', 'no_show'] as const) {
        const existing = { technicianId: 'tech-1', range: candidate.range, status };
        expect(visitConflictsWith(candidate, existing)).toBe(false);
      }
    });
  });

  describe('findVisitConflict', () => {
    it('devolve a primeira visita conflitante, ou null se nenhuma', () => {
      const candidate = { technicianId: 'tech-1', range: visitTimeRange(new Date('2026-07-20T09:00:00Z'), 60) };
      const existing = [
        { id: 'v1', technicianId: 'tech-1', range: visitTimeRange(new Date('2026-07-20T07:00:00Z'), 60), status: 'completed' as const },
        { id: 'v2', technicianId: 'tech-1', range: visitTimeRange(new Date('2026-07-20T09:15:00Z'), 30), status: 'scheduled' as const },
      ];
      expect(findVisitConflict(candidate, existing)?.id).toBe('v2');
      expect(findVisitConflict(candidate, [existing[0]])).toBeNull();
    });
  });
});
