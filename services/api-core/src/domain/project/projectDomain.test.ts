import { describe, it, expect } from 'vitest';
import {
  assertProjectTransition,
  assertProjectEditable,
  validateProjectCreate,
  validateProfessionalAllocation,
  calcProjectReport,
  ProjectDomainError,
} from './projectDomain';

function catchDomainError(fn: () => void): ProjectDomainError {
  try { fn(); throw new Error('expected throw'); } catch (e) { return e as ProjectDomainError; }
}

describe('project state machine', () => {
  it('draft → in_progress is valid', () => {
    expect(() => assertProjectTransition('draft', 'in_progress')).not.toThrow();
  });

  it('draft → cancelled is valid', () => {
    expect(() => assertProjectTransition('draft', 'cancelled')).not.toThrow();
  });

  it('in_progress → completed is valid', () => {
    expect(() => assertProjectTransition('in_progress', 'completed')).not.toThrow();
  });

  it('in_progress → cancelled is valid', () => {
    expect(() => assertProjectTransition('in_progress', 'cancelled')).not.toThrow();
  });

  it('draft → completed throws (must go through in_progress)', () => {
    expect(() => assertProjectTransition('draft', 'completed')).toThrow(ProjectDomainError);
  });

  it('completed → any throws (terminal state)', () => {
    expect(() => assertProjectTransition('completed', 'cancelled')).toThrow(ProjectDomainError);
  });

  it('cancelled → any throws (terminal state)', () => {
    expect(() => assertProjectTransition('cancelled', 'draft')).toThrow(ProjectDomainError);
  });
});

describe('assertProjectEditable', () => {
  it('draft is editable', () => {
    expect(() => assertProjectEditable('draft')).not.toThrow();
  });

  it('in_progress/completed/cancelled are not editable', () => {
    expect(() => assertProjectEditable('in_progress')).toThrow(ProjectDomainError);
    expect(() => assertProjectEditable('completed')).toThrow(ProjectDomainError);
    expect(() => assertProjectEditable('cancelled')).toThrow(ProjectDomainError);
  });
});

describe('validateProjectCreate', () => {
  it('passes with valid input', () => {
    expect(() => validateProjectCreate({ name: 'Reforma Loja A', total_value: 15000 })).not.toThrow();
  });

  it('throws project_name_required when name is empty', () => {
    const err = catchDomainError(() => validateProjectCreate({ name: '  ', total_value: 100 }));
    expect(err).toMatchObject({ code: 'project_name_required' });
  });

  it('throws project_total_value_invalid for negative total_value', () => {
    const err = catchDomainError(() => validateProjectCreate({ name: 'X', total_value: -1 }));
    expect(err).toMatchObject({ code: 'project_total_value_invalid' });
  });

  it('accepts total_value = 0', () => {
    expect(() => validateProjectCreate({ name: 'X', total_value: 0 })).not.toThrow();
  });
});

describe('validateProfessionalAllocation', () => {
  it('passes for a technician allocation', () => {
    expect(() => validateProfessionalAllocation({
      professional_type: 'technician', technician_id: 'tech-1', commission_pct: 5,
    })).not.toThrow();
  });

  it('passes for a seller allocation', () => {
    expect(() => validateProfessionalAllocation({
      professional_type: 'seller', seller_id: 'seller-1', commission_pct: 3.5,
    })).not.toThrow();
  });

  it('throws project_professional_technician_required when type=technician without technician_id', () => {
    const err = catchDomainError(() => validateProfessionalAllocation({
      professional_type: 'technician', commission_pct: 5,
    }));
    expect(err).toMatchObject({ code: 'project_professional_technician_required' });
  });

  it('throws project_professional_seller_required when type=seller without seller_id', () => {
    const err = catchDomainError(() => validateProfessionalAllocation({
      professional_type: 'seller', commission_pct: 5,
    }));
    expect(err).toMatchObject({ code: 'project_professional_seller_required' });
  });

  it('throws project_professional_conflicting_ids when both ids are set', () => {
    const err = catchDomainError(() => validateProfessionalAllocation({
      professional_type: 'technician', technician_id: 't1', seller_id: 's1', commission_pct: 5,
    }));
    expect(err).toMatchObject({ code: 'project_professional_conflicting_ids' });
  });

  it('throws project_professional_commission_invalid when commission_pct is out of range', () => {
    expect(catchDomainError(() => validateProfessionalAllocation({
      professional_type: 'technician', technician_id: 't1', commission_pct: -1,
    }))).toMatchObject({ code: 'project_professional_commission_invalid' });
    expect(catchDomainError(() => validateProfessionalAllocation({
      professional_type: 'technician', technician_id: 't1', commission_pct: 101,
    }))).toMatchObject({ code: 'project_professional_commission_invalid' });
  });
});

describe('calcProjectReport', () => {
  it('sums orders + service orders into goods/services consumed and invoiced', () => {
    const result = calcProjectReport({
      total_value: 10000,
      ordersTotal: 3000, ordersInvoicedTotal: 2000,
      serviceOrdersTotal: 1000, serviceOrdersBilledTotal: 500,
    });
    expect(result.goodsServicesConsumed).toBe(4000);
    expect(result.goodsServicesInvoiced).toBe(2500);
    expect(result.budgetConsumedPct).toBe(40);
    expect(result.budgetInvoicedPct).toBe(25);
  });

  it('guards against division by zero when total_value is 0', () => {
    const result = calcProjectReport({
      total_value: 0, ordersTotal: 500, ordersInvoicedTotal: 500,
      serviceOrdersTotal: 0, serviceOrdersBilledTotal: 0,
    });
    expect(result.budgetConsumedPct).toBe(0);
    expect(result.budgetInvoicedPct).toBe(0);
    expect(result.goodsServicesConsumed).toBe(500);
  });

  it('rounds percentages to 2 decimals', () => {
    const result = calcProjectReport({
      total_value: 3, ordersTotal: 1, ordersInvoicedTotal: 0,
      serviceOrdersTotal: 0, serviceOrdersBilledTotal: 0,
    });
    expect(result.budgetConsumedPct).toBe(33.33);
  });
});
