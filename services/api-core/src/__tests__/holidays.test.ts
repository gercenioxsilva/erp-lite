// E9: feriados nacionais e o efeito no vencimento do DAS.

import { describe, it, expect } from 'vitest';
import { easterSunday, nationalHolidays, isBusinessDay } from '../domain/fiscal/holidays';
import { dasDueDate } from '../domain/fiscal/alertRulesDomain';

describe('easterSunday (Meeus/Butcher)', () => {
  it('bate com datas conhecidas', () => {
    expect(easterSunday(2025).toDateString()).toBe('Sun Apr 20 2025');
    expect(easterSunday(2026).toDateString()).toBe('Sun Apr 05 2026');
  });
});

describe('nationalHolidays', () => {
  it('inclui fixos + móveis derivados da Páscoa', () => {
    const h = nationalHolidays(2026);
    expect(h.has('2026-01-01')).toBe(true); // Confraternização
    expect(h.has('2026-09-07')).toBe(true); // Independência
    expect(h.has('2026-11-20')).toBe(true); // Consciência Negra
    expect(h.has('2026-12-25')).toBe(true); // Natal
    expect(h.has('2026-04-03')).toBe(true); // Sexta-feira Santa (Páscoa 05/04 − 2)
    expect(h.has('2026-06-04')).toBe(true); // Corpus Christi (Páscoa + 60)
    expect(h.has('2026-02-17')).toBe(true); // Carnaval terça (Páscoa − 47)
  });
});

describe('isBusinessDay', () => {
  const h = nationalHolidays(2026);
  it('recusa fim de semana e feriado; aceita dia útil comum', () => {
    expect(isBusinessDay(new Date(2026, 10, 20), h)).toBe(false); // sexta, feriado
    expect(isBusinessDay(new Date(2026, 10, 21), h)).toBe(false); // sábado
    expect(isBusinessDay(new Date(2026, 10, 23), h)).toBe(true);  // segunda útil
  });
});

describe('dasDueDate com feriados', () => {
  it('outubro/2026: dia 20/11 é Consciência Negra (sexta) → pula feriado + fim de semana → 23/11', () => {
    expect(dasDueDate('2026-10').toISOString().slice(0, 10)).toBe('2026-11-23');
  });

  it('sem feriado no caminho continua no dia 20 útil', () => {
    expect(dasDueDate('2026-06').toISOString().slice(0, 10)).toBe('2026-07-20'); // segunda
  });
});
