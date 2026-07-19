import { describe, it, expect } from 'vitest';
import { competenciaFromDate, fiscalDate } from '../domain/fiscal/competencia';

// Regressão do skew UTC/BRT: o ciclo fiscal dispara 23:59 America/Sao_Paulo,
// que em UTC já é o dia (e o mês) seguinte. Carimbar por new Date() em UTC
// arquiva a receita do último dia do mês na competência errada.

describe('competenciaFromDate / fiscalDate', () => {
  it('mantém a competência no mês BR quando a autorização é 23:59 do último dia', () => {
    // 2026-01-31 23:59 -03:00  ==  2026-02-01 02:59 UTC
    const authAt = new Date('2026-01-31T23:59:00-03:00');
    expect(authAt.toISOString().slice(0, 7)).toBe('2026-02'); // o bug: UTC diz fevereiro
    expect(competenciaFromDate(authAt)).toBe('2026-01');       // fuso fiscal diz janeiro
    expect(fiscalDate(authAt)).toBe('2026-01-31');
  });

  it('vira a competência corretamente quando já passou da meia-noite BR', () => {
    const authAt = new Date('2026-02-01T00:10:00-03:00');
    expect(competenciaFromDate(authAt)).toBe('2026-02');
    expect(fiscalDate(authAt)).toBe('2026-02-01');
  });

  it('converte um instante UTC de madrugada para o dia BR anterior', () => {
    // 2026-03-01 02:00 UTC == 2026-02-28 23:00 -03:00
    const authAt = new Date('2026-03-01T02:00:00Z');
    expect(competenciaFromDate(authAt)).toBe('2026-02');
    expect(fiscalDate(authAt)).toBe('2026-02-28');
  });
});
