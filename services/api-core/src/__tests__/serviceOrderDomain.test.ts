import { describe, it, expect } from 'vitest';
import {
  assertServiceOrderTransition,
  calcServiceOrderTotals,
  validateServiceOrderCreate,
  canCompleteServiceOrder,
  ServiceOrderDomainError,
} from '../domain/serviceOrder/serviceOrderDomain';

describe('serviceOrder state machine', () => {
  it('draft → scheduled is valid', () => {
    expect(() => assertServiceOrderTransition('draft', 'scheduled')).not.toThrow();
  });

  it('draft → cancelled is valid', () => {
    expect(() => assertServiceOrderTransition('draft', 'cancelled')).not.toThrow();
  });

  it('scheduled → in_progress is valid', () => {
    expect(() => assertServiceOrderTransition('scheduled', 'in_progress')).not.toThrow();
  });

  it('in_progress → completed is valid', () => {
    expect(() => assertServiceOrderTransition('in_progress', 'completed')).not.toThrow();
  });

  it('draft → in_progress throws (must be scheduled first)', () => {
    expect(() => assertServiceOrderTransition('draft', 'in_progress')).toThrow(ServiceOrderDomainError);
  });

  it('completed → any throws (terminal state)', () => {
    expect(() => assertServiceOrderTransition('completed', 'cancelled')).toThrow(ServiceOrderDomainError);
  });

  it('cancelled → any throws (terminal state)', () => {
    expect(() => assertServiceOrderTransition('cancelled', 'draft')).toThrow(ServiceOrderDomainError);
  });
});

describe('calcServiceOrderTotals', () => {
  it('sums quantity * unit_price across items', () => {
    const { subtotal, total } = calcServiceOrderTotals([
      { quantity: 2, unit_price: 50 },
      { quantity: 1, unit_price: 100 },
    ]);
    expect(subtotal).toBe(200);
    expect(total).toBe(200);
  });

  it('rounds to 2 decimals', () => {
    const { subtotal } = calcServiceOrderTotals([{ quantity: 3, unit_price: 33.33 }]);
    expect(subtotal).toBe(99.99);
  });

  it('returns 0 for no items', () => {
    const { subtotal, total } = calcServiceOrderTotals([]);
    expect(subtotal).toBe(0);
    expect(total).toBe(0);
  });
});

function catchDomainError(fn: () => void): ServiceOrderDomainError {
  try { fn(); throw new Error('expected throw'); } catch (e) { return e as ServiceOrderDomainError; }
}

describe('validateServiceOrderCreate', () => {
  it('passes with valid input', () => {
    expect(() => validateServiceOrderCreate({ title: 'Manutenção preventiva', type: 'maintenance' })).not.toThrow();
  });

  it('throws service_order_title_required when title is empty', () => {
    const err = catchDomainError(() => validateServiceOrderCreate({ title: '  ', type: 'maintenance' }));
    expect(err).toMatchObject({ code: 'service_order_title_required' });
  });

  it('throws service_order_invalid_type for an unknown type', () => {
    const err = catchDomainError(() => validateServiceOrderCreate({ title: 'X', type: 'foo' as any }));
    expect(err).toMatchObject({ code: 'service_order_invalid_type' });
  });

  it('throws service_order_item_quantity_zero when an item has quantity <= 0', () => {
    const err = catchDomainError(() => validateServiceOrderCreate({
      title: 'X', type: 'repair', items: [{ quantity: 0, unit_price: 10 }],
    }));
    expect(err).toMatchObject({ code: 'service_order_item_quantity_zero' });
  });

  it('throws service_order_item_price_negative when an item has negative price', () => {
    const err = catchDomainError(() => validateServiceOrderCreate({
      title: 'X', type: 'repair', items: [{ quantity: 1, unit_price: -1 }],
    }));
    expect(err).toMatchObject({ code: 'service_order_item_price_negative' });
  });
});

describe('canCompleteServiceOrder', () => {
  it('false with no visits', () => {
    expect(canCompleteServiceOrder([])).toBe(false);
  });

  it('false when any visit is still open', () => {
    expect(canCompleteServiceOrder(['completed', 'in_progress'])).toBe(false);
  });

  it('true when all visits are terminal', () => {
    expect(canCompleteServiceOrder(['completed', 'cancelled', 'no_show'])).toBe(true);
  });
});
