// Critérios de aceite: conclusão dupla falha e o saldo nunca fica negativo;
// saldo zerado vira 'exhausted' na mesma operação. Mais a usabilidade do
// pacote escolhido num agendamento (área/validade) — lembrando que agendar
// sem pacote é permitido (decisão nº 8), então isso só roda com pacote eleito.

import { describe, it, expect } from 'vitest';
import {
  remainingSessions, applyDebit, assertPackageUsableForBooking, PackageUsability,
} from '../domain/scheduling/packageDomain';
import { SchedulingDomainError } from '../domain/scheduling/schedulingDomain';

const TODAY = '2026-07-09';
const CARRO = 'area-carro';
const MOTO = 'area-moto';

const pkg = (over: Partial<PackageUsability> = {}): PackageUsability => ({
  status: 'active',
  areaId: null,
  validUntil: null,
  totalSessions: 10,
  usedSessions: 0,
  ...over,
});

describe('applyDebit — débito atômico de 1 na conclusão', () => {
  it('debita exatamente 1 e mantém ativo enquanto há saldo', () => {
    expect(applyDebit({ totalSessions: 10, usedSessions: 3 }))
      .toEqual({ usedSessions: 4, status: 'active' });
  });

  it('saldo chegando a zero vira exhausted na mesma operação', () => {
    expect(applyDebit({ totalSessions: 10, usedSessions: 9 }))
      .toEqual({ usedSessions: 10, status: 'exhausted' });
  });

  it('débito sem saldo falha — saldo nunca fica negativo', () => {
    try {
      applyDebit({ totalSessions: 10, usedSessions: 10 });
      expect.unreachable('deveria ter lançado package_no_balance');
    } catch (e) {
      expect((e as SchedulingDomainError).code).toBe('package_no_balance');
    }
  });

  it('conclusão dupla: o segundo débito do pacote de 1 sessão falha', () => {
    const first = applyDebit({ totalSessions: 1, usedSessions: 0 });
    expect(first).toEqual({ usedSessions: 1, status: 'exhausted' });
    expect(() => applyDebit({ totalSessions: 1, usedSessions: first.usedSessions }))
      .toThrowError(SchedulingDomainError);
  });

  it('remainingSessions é derivado, nunca persistido', () => {
    expect(remainingSessions({ totalSessions: 10, usedSessions: 4 })).toBe(6);
  });
});

describe('assertPackageUsableForBooking', () => {
  const code = (fn: () => void): string => {
    try { fn(); return ''; } catch (e) { return (e as SchedulingDomainError).code; }
  };

  it('pacote ativo com saldo e área compatível passa', () => {
    expect(() => assertPackageUsableForBooking(pkg({ areaId: CARRO }), CARRO, TODAY)).not.toThrow();
  });

  it('pacote "qualquer área" (areaId null) cobre qualquer área concreta', () => {
    expect(() => assertPackageUsableForBooking(pkg(), CARRO, TODAY)).not.toThrow();
    expect(() => assertPackageUsableForBooking(pkg(), MOTO, TODAY)).not.toThrow();
  });

  it('área do pacote diferente da escolhida ⇒ package_area_mismatch', () => {
    expect(code(() => assertPackageUsableForBooking(pkg({ areaId: MOTO }), CARRO, TODAY)))
      .toBe('package_area_mismatch');
  });

  it('status não-ativo ⇒ package_not_active', () => {
    for (const status of ['exhausted', 'expired', 'canceled'] as const) {
      expect(code(() => assertPackageUsableForBooking(pkg({ status }), CARRO, TODAY)))
        .toBe('package_not_active');
    }
  });

  it('validade vencida ⇒ package_expired; no dia do vencimento ainda vale', () => {
    expect(code(() => assertPackageUsableForBooking(pkg({ validUntil: '2026-07-08' }), CARRO, TODAY)))
      .toBe('package_expired');
    expect(() => assertPackageUsableForBooking(pkg({ validUntil: TODAY }), CARRO, TODAY))
      .not.toThrow();
  });

  it('sem saldo derivado ⇒ package_exhausted (mesmo que o status ainda diga active)', () => {
    expect(code(() => assertPackageUsableForBooking(pkg({ usedSessions: 10 }), CARRO, TODAY)))
      .toBe('package_exhausted');
  });
});
