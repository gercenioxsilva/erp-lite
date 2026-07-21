import { describe, it, expect } from 'vitest';
import {
  validatePaymentPlanInstallments,
  addDaysToDateStr,
  generateInstallmentSchedule,
  PaymentPlanDomainError,
  type PaymentPlanInstallmentInput,
} from '../paymentPlanDomain';

function catchDomainError(fn: () => void): PaymentPlanDomainError {
  try { fn(); throw new Error('expected throw'); } catch (e) { return e as PaymentPlanDomainError; }
}

// ── validatePaymentPlanInstallments ─────────────────────────────────────────────

describe('validatePaymentPlanInstallments', () => {
  it('aceita "à vista" (1 parcela, 100%)', () => {
    expect(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0, percentage: 100 },
    ])).not.toThrow();
  });

  it('aceita "3x sem juros" (33,34/33,33/33,33)', () => {
    expect(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0,  percentage: 33.34 },
      { installment_number: 2, days_offset: 30, percentage: 33.33 },
      { installment_number: 3, days_offset: 60, percentage: 33.33 },
    ])).not.toThrow();
  });

  it('rejeita lista vazia', () => {
    const err = catchDomainError(() => validatePaymentPlanInstallments([]));
    expect(err).toMatchObject({ code: 'payment_plan_no_installments' });
  });

  it('rejeita numeração de parcela com lacuna', () => {
    const err = catchDomainError(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0,  percentage: 50 },
      { installment_number: 3, days_offset: 30, percentage: 50 },
    ]));
    expect(err).toMatchObject({ code: 'payment_plan_installment_numbers_invalid' });
  });

  it('rejeita dias regredindo conforme a parcela avança', () => {
    const err = catchDomainError(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 30, percentage: 50 },
      { installment_number: 2, days_offset: 10, percentage: 50 },
    ]));
    expect(err).toMatchObject({ code: 'payment_plan_days_offset_out_of_order' });
  });

  it('rejeita percentual negativo ou zero', () => {
    const err = catchDomainError(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0, percentage: 0 },
    ]));
    expect(err).toMatchObject({ code: 'payment_plan_percentage_invalid' });
  });

  it('rejeita soma de percentuais diferente de 100%', () => {
    const err = catchDomainError(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0,  percentage: 40 },
      { installment_number: 2, days_offset: 30, percentage: 40 },
    ]));
    expect(err).toMatchObject({ code: 'payment_plan_percentage_sum_invalid' });
  });

  it('tolera erro de arredondamento de até 1 centésimo na soma', () => {
    expect(() => validatePaymentPlanInstallments([
      { installment_number: 1, days_offset: 0, percentage: 33.34 },
      { installment_number: 2, days_offset: 30, percentage: 33.33 },
      { installment_number: 3, days_offset: 60, percentage: 33.335 }, // soma 100.005, dentro da tolerância
    ])).not.toThrow();
  });
});

// ── addDaysToDateStr ─────────────────────────────────────────────────────────────

describe('addDaysToDateStr', () => {
  it('soma dias corridos dentro do mesmo mês', () => {
    expect(addDaysToDateStr('2026-07-01', 10)).toBe('2026-07-11');
  });

  it('30/60/90 dias corridos — nunca vira "3 meses calendário"', () => {
    // 20/07 + 90 dias corridos ≠ 20/10 (mês calendário) — é 18/10.
    expect(addDaysToDateStr('2026-07-20', 30)).toBe('2026-08-19');
    expect(addDaysToDateStr('2026-07-20', 60)).toBe('2026-09-18');
    expect(addDaysToDateStr('2026-07-20', 90)).toBe('2026-10-18');
  });

  it('soma 0 dias retorna a mesma data', () => {
    expect(addDaysToDateStr('2026-03-20', 0)).toBe('2026-03-20');
  });

  it('atravessa virada de ano', () => {
    expect(addDaysToDateStr('2026-12-20', 15)).toBe('2027-01-04');
  });
});

// ── generateInstallmentSchedule ───────────────────────────────────────────────────

describe('generateInstallmentSchedule', () => {
  const threeX: PaymentPlanInstallmentInput[] = [
    { installment_number: 1, days_offset: 0,  percentage: 33.34 },
    { installment_number: 2, days_offset: 30, percentage: 33.33 },
    { installment_number: 3, days_offset: 60, percentage: 33.33 },
  ];

  it('gera 1 parcela pra "à vista"', () => {
    const schedule = generateInstallmentSchedule(1000, '2026-07-20', [
      { installment_number: 1, days_offset: 0, percentage: 100 },
    ]);
    expect(schedule).toEqual([
      { installment_number: 1, installment_total: 1, due_date: '2026-07-20', amount: '1000.00' },
    ]);
  });

  it('gera 3 parcelas com vencimentos em dias corridos', () => {
    const schedule = generateInstallmentSchedule(100, '2026-07-20', threeX);
    expect(schedule).toHaveLength(3);
    expect(schedule[0].due_date).toBe('2026-07-20');
    expect(schedule[1].due_date).toBe('2026-08-19');
    expect(schedule[2].due_date).toBe('2026-09-18');
    expect(schedule.every(s => s.installment_total === 3)).toBe(true);
  });

  it('resto de centavos do arredondamento vai sempre pra última parcela — soma bate exato', () => {
    // 33,33% × 3 = 99,99% (dentro da tolerância de 0,01) — cada parcela
    // isolada arredondaria pra 33,33, perdendo 1 centavo; a última parcela
    // absorve a diferença e fecha em 33,34.
    const schedule = generateInstallmentSchedule(100, '2026-07-20', [
      { installment_number: 1, days_offset: 0,  percentage: 33.33 },
      { installment_number: 2, days_offset: 30, percentage: 33.33 },
      { installment_number: 3, days_offset: 60, percentage: 33.33 },
    ]);
    const sumCents = schedule.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
    expect(sumCents).toBe(10000); // R$100,00 em centavos, nunca sobra/falta 1 centavo
    expect(schedule[0].amount).toBe('33.33');
    expect(schedule[1].amount).toBe('33.33');
    expect(schedule[2].amount).toBe('33.34'); // resto de 1 centavo absorvido pela última
  });

  it('propaga erro de validação do domínio (nunca gera cronograma de plano inválido)', () => {
    expect(() => generateInstallmentSchedule(100, '2026-07-20', [
      { installment_number: 1, days_offset: 0, percentage: 40 },
    ])).toThrow(PaymentPlanDomainError);
  });
});
