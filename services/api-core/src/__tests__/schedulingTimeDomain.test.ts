// Critério de aceite: overlap meio-aberto correto — terminar 09:00 não
// conflita com começar 09:00. Mais a aritmética de faixas que sustenta o
// engine de slots (merge/subtract) e as conversões HH:mm.

import { describe, it, expect } from 'vitest';
import {
  overlaps, mergeRanges, subtractRange, subtractAll,
  hmToMinutes, minutesToHm, assertValidRange, addDaysISO, weekdayOf,
} from '../domain/scheduling/timeDomain';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

describe('overlaps — intervalos meio-abertos [start, end)', () => {
  it('encostados NÃO conflitam: fim 09:00 vs início 09:00 (nos dois sentidos)', () => {
    expect(overlaps({ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' })).toBe(false);
    expect(overlaps({ start: '09:00', end: '10:00' }, { start: '08:00', end: '09:00' })).toBe(false);
  });

  it('sobreposição parcial conflita', () => {
    expect(overlaps({ start: '08:00', end: '09:30' }, { start: '09:00', end: '10:00' })).toBe(true);
  });

  it('contenção total conflita', () => {
    expect(overlaps({ start: '08:00', end: '12:00' }, { start: '09:00', end: '10:00' })).toBe(true);
    expect(overlaps({ start: '09:00', end: '10:00' }, { start: '08:00', end: '12:00' })).toBe(true);
  });

  it('intervalos idênticos conflitam', () => {
    expect(overlaps({ start: '09:00', end: '10:00' }, { start: '09:00', end: '10:00' })).toBe(true);
  });

  it('disjuntos não conflitam', () => {
    expect(overlaps({ start: '08:00', end: '09:00' }, { start: '10:00', end: '11:00' })).toBe(false);
  });
});

describe('mergeRanges', () => {
  it('funde faixas que se encostam (abertura extra colada na grade)', () => {
    expect(mergeRanges([
      { start: '08:00', end: '10:00' },
      { start: '10:00', end: '12:00' },
    ])).toEqual([{ start: '08:00', end: '12:00' }]);
  });

  it('funde sobrepostas e mantém disjuntas, mesmo fora de ordem', () => {
    expect(mergeRanges([
      { start: '14:00', end: '16:00' },
      { start: '08:00', end: '10:30' },
      { start: '10:00', end: '11:00' },
    ])).toEqual([
      { start: '08:00', end: '11:00' },
      { start: '14:00', end: '16:00' },
    ]);
  });

  it('faixa contida não estica o fim', () => {
    expect(mergeRanges([
      { start: '08:00', end: '12:00' },
      { start: '09:00', end: '10:00' },
    ])).toEqual([{ start: '08:00', end: '12:00' }]);
  });

  it('lista vazia devolve vazio', () => {
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('subtractRange / subtractAll', () => {
  it('corte no meio produz dois fragmentos', () => {
    expect(subtractRange({ start: '08:00', end: '12:00' }, { start: '09:00', end: '10:00' }))
      .toEqual([{ start: '08:00', end: '09:00' }, { start: '10:00', end: '12:00' }]);
  });

  it('corte na borda produz um fragmento', () => {
    expect(subtractRange({ start: '08:00', end: '12:00' }, { start: '08:00', end: '09:00' }))
      .toEqual([{ start: '09:00', end: '12:00' }]);
  });

  it('corte total elimina a faixa', () => {
    expect(subtractRange({ start: '09:00', end: '10:00' }, { start: '08:00', end: '12:00' }))
      .toEqual([]);
  });

  it('sem overlap devolve a base intacta', () => {
    expect(subtractRange({ start: '08:00', end: '09:00' }, { start: '09:00', end: '10:00' }))
      .toEqual([{ start: '08:00', end: '09:00' }]);
  });

  it('subtractAll aplica todos os cortes em todas as bases', () => {
    expect(subtractAll(
      [{ start: '08:00', end: '12:00' }],
      [{ start: '09:00', end: '09:30' }, { start: '11:00', end: '12:00' }],
    )).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '09:30', end: '11:00' },
    ]);
  });
});

describe('conversões e validações HH:mm', () => {
  it('hmToMinutes/minutesToHm são inversas', () => {
    expect(hmToMinutes('09:30')).toBe(570);
    expect(minutesToHm(570)).toBe('09:30');
    expect(minutesToHm(0)).toBe('00:00');
    expect(hmToMinutes('23:59')).toBe(1439);
  });

  it('rejeita formatos inválidos (sem zero-pad, 24:00, minuto 60)', () => {
    for (const bad of ['9:00', '24:00', '09:60', '0900', '']) {
      expect(() => hmToMinutes(bad)).toThrowError(SchedulingDomainError);
    }
  });

  it('assertValidRange exige início < fim', () => {
    expect(() => assertValidRange({ start: '10:00', end: '09:00' })).toThrowError(SchedulingDomainError);
    expect(() => assertValidRange({ start: '09:00', end: '09:00' })).toThrowError(SchedulingDomainError);
    expect(() => assertValidRange({ start: '09:00', end: '10:00' })).not.toThrow();
  });
});

describe('datas ISO', () => {
  it('addDaysISO cruza mês e ano em UTC', () => {
    expect(addDaysISO('2026-07-09', 30)).toBe('2026-08-08');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('weekdayOf usa a convenção 0=domingo de Date.getUTCDay', () => {
    expect(weekdayOf('2026-07-09')).toBe(4); // quinta-feira
    expect(weekdayOf('2026-07-12')).toBe(0); // domingo
  });

  it('rejeita datas inválidas (inclusive 31 de fevereiro)', () => {
    expect(() => weekdayOf('2026-02-31')).toThrowError(SchedulingDomainError);
    expect(() => addDaysISO('09/07/2026', 1)).toThrowError(SchedulingDomainError);
  });
});
