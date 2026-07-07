import { describe, it, expect } from 'vitest';
import {
  assertCanBillServiceOrder,
  defaultBillingDueDate,
  ServiceOrderBillingDomainError,
} from '../domain/serviceOrderBilling/serviceOrderBillingDomain';

describe('assertCanBillServiceOrder', () => {
  it('permite faturar uma OS concluída e ainda não faturada', () => {
    expect(() => assertCanBillServiceOrder('completed', false)).not.toThrow();
  });

  it('bloqueia faturar uma OS que não está concluída', () => {
    expect(() => assertCanBillServiceOrder('in_progress', false)).toThrow(ServiceOrderBillingDomainError);
    try { assertCanBillServiceOrder('draft', false); } catch (e) {
      expect((e as ServiceOrderBillingDomainError).code).toBe('service_order_not_completed');
    }
  });

  it('bloqueia faturar uma OS já faturada, mesmo estando completed (idempotência)', () => {
    try { assertCanBillServiceOrder('completed', true); } catch (e) {
      expect((e as ServiceOrderBillingDomainError).code).toBe('service_order_already_billed');
    }
  });
});

describe('defaultBillingDueDate', () => {
  it('soma 7 dias por padrão', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(defaultBillingDueDate(7, now)).toBe('2026-07-17');
  });

  it('aceita um número diferente de dias', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    expect(defaultBillingDueDate(15, now)).toBe('2026-07-25');
  });

  it('rola para o mês seguinte corretamente', () => {
    const now = new Date('2026-07-28T12:00:00Z');
    expect(defaultBillingDueDate(7, now)).toBe('2026-08-04');
  });
});
