import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  calcPOTotals,
  validatePOCreate,
  PurchaseOrderDomainError,
} from '../domain/purchaseOrder/purchaseOrderDomain';

// ── assertTransition ──────────────────────────────────────────────────────────

describe('purchaseOrder state machine', () => {
  it('draft → approved is valid', () => {
    expect(() => assertTransition('draft', 'approved')).not.toThrow();
  });

  it('draft → cancelled is valid', () => {
    expect(() => assertTransition('draft', 'cancelled')).not.toThrow();
  });

  it('approved → received is valid', () => {
    expect(() => assertTransition('approved', 'received')).not.toThrow();
  });

  it('approved → cancelled is valid', () => {
    expect(() => assertTransition('approved', 'cancelled')).not.toThrow();
  });

  it('received → any throws (terminal state)', () => {
    expect(() => assertTransition('received', 'approved')).toThrow(PurchaseOrderDomainError);
    expect(() => assertTransition('received', 'cancelled')).toThrow(PurchaseOrderDomainError);
  });

  it('cancelled → any throws (terminal state)', () => {
    expect(() => assertTransition('cancelled', 'draft')).toThrow(PurchaseOrderDomainError);
  });

  it('draft → received throws (must be approved first)', () => {
    expect(() => assertTransition('draft', 'received')).toThrow(PurchaseOrderDomainError);
  });

  it('error has code invalid_po_transition and includes allowed list', () => {
    try {
      assertTransition('received', 'approved');
    } catch (e) {
      expect(e).toBeInstanceOf(PurchaseOrderDomainError);
      expect((e as PurchaseOrderDomainError).code).toBe('invalid_po_transition');
      expect((e as PurchaseOrderDomainError).payload?.from).toBe('received');
    }
  });
});

// ── calcPOTotals ──────────────────────────────────────────────────────────────

describe('calcPOTotals', () => {
  it('computes subtotal and total correctly', () => {
    const { subtotal, total } = calcPOTotals(
      [{ quantity: 10, unit_price: 50 }, { quantity: 2, unit_price: 100 }],
      0, 0,
    );
    expect(subtotal).toBe(700); // 500 + 200
    expect(total).toBe(700);
  });

  it('applies discount and shipping', () => {
    const { subtotal, total } = calcPOTotals(
      [{ quantity: 1, unit_price: 1000 }],
      50, 30,
    );
    expect(subtotal).toBe(1000);
    expect(total).toBe(980); // 1000 - 50 + 30
  });

  it('total is never negative (floors at 0)', () => {
    const { total } = calcPOTotals([{ quantity: 1, unit_price: 10 }], 1000, 0);
    expect(total).toBe(0);
  });

  it('rounds to 2 decimals (3 × 33.33 = 99.99)', () => {
    const { subtotal } = calcPOTotals([{ quantity: 3, unit_price: 33.33 }], 0, 0);
    // 3 * 33.33 = 99.99 exactly
    expect(subtotal).toBe(99.99);
  });
});

// ── validatePOCreate ──────────────────────────────────────────────────────────

function catchDomainError(fn: () => void): PurchaseOrderDomainError {
  try { fn(); throw new Error('expected throw'); } catch (e) { return e as PurchaseOrderDomainError; }
}

describe('validatePOCreate', () => {
  it('passes with valid items', () => {
    expect(() => validatePOCreate({
      items: [{ quantity: 5, unit_price: 10 }],
    })).not.toThrow();
  });

  it('throws po_no_items when items array is empty', () => {
    const err = catchDomainError(() => validatePOCreate({ items: [] }));
    expect(err).toMatchObject({ code: 'po_no_items' });
  });

  it('throws po_item_quantity_zero when quantity is 0', () => {
    const err = catchDomainError(() => validatePOCreate({ items: [{ quantity: 0, unit_price: 10 }] }));
    expect(err).toMatchObject({ code: 'po_item_quantity_zero' });
  });

  it('throws po_item_price_negative when price is negative', () => {
    const err = catchDomainError(() => validatePOCreate({ items: [{ quantity: 1, unit_price: -5 }] }));
    expect(err).toMatchObject({ code: 'po_item_price_negative' });
  });
});
