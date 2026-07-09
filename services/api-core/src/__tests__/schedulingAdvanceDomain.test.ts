// Antecedência mínima e janela de cancelamento no fuso do tenant — `now`
// injetável (instantes fixos), América/São Paulo = UTC-3 (sem DST hoje).
// A soma de horas acontece no espaço UTC (DST-safe); só a formatação é no fuso.

import { describe, it, expect } from 'vitest';
import {
  wallClockInTimezone, earliestBookableInstant, violatesMinAdvance, withinCancelWindow,
} from '../domain/scheduling/advanceDomain';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

const SP = 'America/Sao_Paulo';

describe('wallClockInTimezone', () => {
  it('converte instante UTC para wall-clock do tenant', () => {
    expect(wallClockInTimezone(SP, new Date('2026-07-09T12:00:00Z')))
      .toEqual({ date: '2026-07-09', time: '09:00' });
  });

  it('vira o dia corretamente perto da meia-noite local', () => {
    // 02:30Z = 23:30 do dia anterior em SP
    expect(wallClockInTimezone(SP, new Date('2026-07-10T02:30:00Z')))
      .toEqual({ date: '2026-07-09', time: '23:30' });
    // meia-noite local exata nunca vira '24:00'
    expect(wallClockInTimezone(SP, new Date('2026-07-10T03:00:00Z')))
      .toEqual({ date: '2026-07-10', time: '00:00' });
  });

  it('fuso inválido é rejeitado', () => {
    expect(() => wallClockInTimezone('America/Nao_Existe', new Date()))
      .toThrowError(SchedulingDomainError);
  });
});

describe('earliestBookableInstant', () => {
  it('agora + antecedência, no fuso do tenant', () => {
    // 09:00 SP + 12h = 21:00 SP do mesmo dia
    expect(earliestBookableInstant(SP, 12, new Date('2026-07-09T12:00:00Z')))
      .toEqual({ date: '2026-07-09', time: '21:00' });
  });

  it('cruza a meia-noite: antecedência empurra para o dia seguinte', () => {
    // 17:00 SP + 12h = 05:00 SP do dia seguinte
    expect(earliestBookableInstant(SP, 12, new Date('2026-07-09T20:00:00Z')))
      .toEqual({ date: '2026-07-10', time: '05:00' });
  });

  it('antecedência zero devolve o próprio agora', () => {
    expect(earliestBookableInstant(SP, 0, new Date('2026-07-09T12:00:00Z')))
      .toEqual({ date: '2026-07-09', time: '09:00' });
  });
});

describe('violatesMinAdvance', () => {
  const earliest = { date: '2026-07-09', time: '21:00' };

  it('sessão antes do momento mínimo viola', () => {
    expect(violatesMinAdvance('2026-07-09', '20:00', earliest)).toBe(true);
    expect(violatesMinAdvance('2026-07-08', '23:00', earliest)).toBe(true);
  });

  it('exatamente no momento mínimo NÃO viola (limite inclusivo)', () => {
    expect(violatesMinAdvance('2026-07-09', '21:00', earliest)).toBe(false);
  });

  it('depois do momento mínimo não viola', () => {
    expect(violatesMinAdvance('2026-07-09', '22:00', earliest)).toBe(false);
    expect(violatesMinAdvance('2026-07-10', '08:00', earliest)).toBe(false);
  });
});

describe('withinCancelWindow — só restringe o cliente (decisão nº 9)', () => {
  const NOW = new Date('2026-07-09T12:00:00Z'); // 09:00 SP

  it('sessão distante da janela pode ser cancelada', () => {
    // janela 24h ⇒ corte em 2026-07-10 09:00 SP; sessão 10:00 está fora
    expect(withinCancelWindow('2026-07-10', '10:00', 24, SP, NOW)).toBe(false);
  });

  it('sessão dentro da janela não pode mais ser cancelada', () => {
    // janela 26h ⇒ corte em 2026-07-10 11:00 SP; sessão 10:00 está dentro
    expect(withinCancelWindow('2026-07-10', '10:00', 26, SP, NOW)).toBe(true);
  });

  it('janela zero só bloqueia sessões que já começaram', () => {
    expect(withinCancelWindow('2026-07-09', '08:00', 0, SP, NOW)).toBe(true);  // já passou
    expect(withinCancelWindow('2026-07-09', '10:00', 0, SP, NOW)).toBe(false); // ainda futura
  });
});
