import { describe, it, expect } from 'vitest';
import {
  assertSITransition,
  matchAgainstPO,
  validateSICreate,
  splitInstallmentAmounts,
  addMonthsToDateStr,
  SupplierInvoiceDomainError,
} from '../domain/supplierInvoice/supplierInvoiceDomain';

// ── assertSITransition ────────────────────────────────────────────────────────

describe('supplierInvoice state machine', () => {
  it('draft → confirmed is valid', () => {
    expect(() => assertSITransition('draft', 'confirmed')).not.toThrow();
  });

  it('draft → cancelled is valid', () => {
    expect(() => assertSITransition('draft', 'cancelled')).not.toThrow();
  });

  it('draft → divergence is valid', () => {
    expect(() => assertSITransition('draft', 'divergence')).not.toThrow();
  });

  it('divergence → confirmed is valid (resolution)', () => {
    expect(() => assertSITransition('divergence', 'confirmed')).not.toThrow();
  });

  it('confirmed → cancelled is valid (exceptional)', () => {
    expect(() => assertSITransition('confirmed', 'cancelled')).not.toThrow();
  });

  it('cancelled → any throws (terminal)', () => {
    expect(() => assertSITransition('cancelled', 'confirmed')).toThrow(SupplierInvoiceDomainError);
  });

  it('error carries code and payload', () => {
    try {
      assertSITransition('cancelled', 'draft');
    } catch (e) {
      expect(e).toBeInstanceOf(SupplierInvoiceDomainError);
      expect((e as SupplierInvoiceDomainError).code).toBe('invalid_si_transition');
    }
  });
});

// ── matchAgainstPO ────────────────────────────────────────────────────────────

describe('matchAgainstPO', () => {
  const baseItem = { material_id: 'mat-1', quantity: 10, unit_price: 50 };

  it('returns ok when quantities and prices match', () => {
    const result = matchAgainstPO([baseItem], [baseItem]);
    expect(result).toBe('ok');
  });

  it('returns no_po when PO items list is empty', () => {
    const result = matchAgainstPO([baseItem], []);
    expect(result).toBe('no_po');
  });

  it('returns quantity_divergence when quantity differs', () => {
    const siItem = { ...baseItem, quantity: 12 };
    const result = matchAgainstPO([siItem], [baseItem]);
    expect(result).toBe('quantity_divergence');
  });

  it('returns price_divergence when unit_price differs by > R$0.01', () => {
    const siItem = { ...baseItem, unit_price: 50.02 };
    const result = matchAgainstPO([siItem], [baseItem]);
    expect(result).toBe('price_divergence');
  });

  it('returns ok for items not in PO (no match = skip)', () => {
    const siItem  = { material_id: 'mat-2', quantity: 5, unit_price: 20 };
    const result  = matchAgainstPO([siItem], [baseItem]);
    expect(result).toBe('ok'); // mat-2 not in PO → not compared
  });

  it('handles tiny float differences within tolerance', () => {
    const siItem = { ...baseItem, unit_price: 50.005 }; // within 0.01 tolerance
    const result = matchAgainstPO([siItem], [baseItem]);
    expect(result).toBe('ok');
  });
});

// ── validateSICreate ──────────────────────────────────────────────────────────

function catchSIDomainError(fn: () => void): SupplierInvoiceDomainError {
  try { fn(); throw new Error('expected throw'); } catch (e) { return e as SupplierInvoiceDomainError; }
}

describe('validateSICreate', () => {
  it('passes with valid input', () => {
    expect(() => validateSICreate({
      items: [{ quantity: 5, unit_price: 100 }],
      total: 500,
    })).not.toThrow();
  });

  it('throws si_no_items when items is empty', () => {
    const err = catchSIDomainError(() => validateSICreate({ items: [], total: 0 }));
    expect(err).toMatchObject({ code: 'si_no_items' });
  });

  it('throws si_item_quantity_zero when quantity <= 0', () => {
    const err = catchSIDomainError(() => validateSICreate({ items: [{ quantity: 0, unit_price: 10 }], total: 0 }));
    expect(err).toMatchObject({ code: 'si_item_quantity_zero' });
  });
});

// ── splitInstallmentAmounts ────────────────────────────────────────────────────

describe('splitInstallmentAmounts', () => {
  it('returns the full total for count=1', () => {
    expect(splitInstallmentAmounts(100, 1)).toEqual([100]);
  });

  it('divides evenly when it divides exactly', () => {
    expect(splitInstallmentAmounts(300, 3)).toEqual([100, 100, 100]);
  });

  it('puts the rounding remainder on the last installment, sum matches total exactly', () => {
    const amounts = splitInstallmentAmounts(100, 3);
    expect(amounts).toEqual([33.33, 33.33, 33.34]);
    const sum = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(100);
  });

  it('handles many installments without losing cents', () => {
    const amounts = splitInstallmentAmounts(1000, 7);
    expect(amounts).toHaveLength(7);
    const sum = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum).toBe(1000);
  });
});

// ── addMonthsToDateStr ──────────────────────────────────────────────────────────

describe('addMonthsToDateStr', () => {
  it('adds one month within the same year', () => {
    expect(addMonthsToDateStr('2026-07-10', 1)).toBe('2026-08-10');
  });

  it('rolls over into the next year', () => {
    expect(addMonthsToDateStr('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('adds multiple months', () => {
    expect(addMonthsToDateStr('2026-01-05', 5)).toBe('2026-06-05');
  });

  it('adding 0 months returns the same date', () => {
    expect(addMonthsToDateStr('2026-03-20', 0)).toBe('2026-03-20');
  });
});
