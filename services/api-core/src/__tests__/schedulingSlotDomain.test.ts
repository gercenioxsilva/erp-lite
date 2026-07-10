// Critérios de aceite do engine de slots: bloqueio parcial fatia, dia inteiro
// zera, abertura extra mescla, resto menor que a duração descarta, antecedência
// corta o mesmo dia (e zera dias anteriores), grade vazia nunca vira "tudo livre".

import { describe, it, expect } from 'vitest';
import { computeFreeSlots, validateWeeklyRule, validateException } from '../domain/scheduling/slotDomain';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

const DATE = '2026-07-09';

const base = {
  weeklyRanges: [{ start: '08:00', end: '12:00' }],
  exceptions: [],
  occupied: [],
  durationMinutes: 60,
  date: DATE,
  earliest: null,
};

describe('computeFreeSlots', () => {
  it('grade simples fatia na duração da área', () => {
    expect(computeFreeSlots({ ...base })).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  it('grade vazia ⇒ nada ofertado (nunca "tudo livre")', () => {
    expect(computeFreeSlots({ ...base, weeklyRanges: [] })).toEqual([]);
  });

  it('bloqueio de dia inteiro zera o dia', () => {
    expect(computeFreeSlots({
      ...base,
      exceptions: [{ kind: 'block', startTime: null, endTime: null }],
    })).toEqual([]);
  });

  it('bloqueio parcial fatia ao redor do corte', () => {
    expect(computeFreeSlots({
      ...base,
      exceptions: [{ kind: 'block', startTime: '09:00', endTime: '10:00' }],
    })).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  it('abertura extra mescla com a grade (encostada vira faixa contínua)', () => {
    expect(computeFreeSlots({
      ...base,
      weeklyRanges: [{ start: '08:00', end: '10:00' }],
      exceptions: [{ kind: 'open', startTime: '10:00', endTime: '12:00' }],
    })).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:00', end: '10:00' },
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  it('abertura extra em dia de grade vazia oferta só a abertura', () => {
    expect(computeFreeSlots({
      ...base,
      weeklyRanges: [],
      exceptions: [{ kind: 'open', startTime: '14:00', endTime: '16:00' }],
    })).toEqual([
      { start: '14:00', end: '15:00' },
      { start: '15:00', end: '16:00' },
    ]);
  });

  it('resto menor que a duração é descartado (09:00–10:30 com 60min ⇒ só 09:00)', () => {
    expect(computeFreeSlots({
      ...base,
      weeklyRanges: [{ start: '09:00', end: '10:30' }],
    })).toEqual([{ start: '09:00', end: '10:00' }]);
  });

  it('sessão ocupada da mesma faixa reancora os slots seguintes', () => {
    expect(computeFreeSlots({
      ...base,
      occupied: [{ start: '09:30', end: '10:30' }],
    })).toEqual([
      { start: '08:00', end: '09:00' }, // 09:00–09:30 sobra < 60min, descartada
      { start: '10:30', end: '11:30' }, // 11:30–12:00 sobra < 60min, descartada
    ]);
  });

  it('antecedência corta os slots do próprio dia que começam cedo demais', () => {
    expect(computeFreeSlots({
      ...base,
      earliest: { date: DATE, time: '10:00' },
    })).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  it('antecedência zera dias inteiros anteriores à data mínima', () => {
    expect(computeFreeSlots({
      ...base,
      earliest: { date: '2026-07-10', time: '00:00' },
    })).toEqual([]);
  });

  it('dias após a data mínima não sofrem corte', () => {
    expect(computeFreeSlots({
      ...base,
      earliest: { date: '2026-07-08', time: '23:00' },
    })).toHaveLength(4);
  });

  it('duração inválida é rejeitada', () => {
    expect(() => computeFreeSlots({ ...base, durationMinutes: 0 })).toThrowError(SchedulingDomainError);
  });
});

describe('validação de disponibilidade', () => {
  it('weekday fora de 0–6 é rejeitado', () => {
    expect(() => validateWeeklyRule({ weekday: 7, startTime: '08:00', endTime: '12:00' }))
      .toThrowError(SchedulingDomainError);
    expect(() => validateWeeklyRule({ weekday: 0, startTime: '08:00', endTime: '12:00' }))
      .not.toThrow();
  });

  it('faixa invertida é rejeitada', () => {
    expect(() => validateWeeklyRule({ weekday: 1, startTime: '12:00', endTime: '08:00' }))
      .toThrowError(SchedulingDomainError);
  });

  it('abertura extra exige horários; bloqueio aceita dia inteiro', () => {
    expect(() => validateException({ kind: 'open', startTime: null, endTime: null }))
      .toThrowError(SchedulingDomainError);
    expect(() => validateException({ kind: 'block', startTime: null, endTime: null }))
      .not.toThrow();
    expect(() => validateException({ kind: 'block', startTime: '09:00', endTime: null }))
      .toThrowError(SchedulingDomainError);
  });
});
