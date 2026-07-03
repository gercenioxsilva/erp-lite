import { describe, it, expect } from 'vitest';
import { canDeactivate, validateNewCompanyCnpj, type CompanyLike } from '../domain/company/companyDomain';

// CNPJs válidos de referência (regra 36 do README — computados, não estruturais)
const CNPJ_A = 'AAAAAA00000171';
const CNPJ_B = 'B2C3D4E5F6G185';
const CNPJ_C = 'ZZTESTE0000198';

describe('canDeactivate', () => {
  const companies: CompanyLike[] = [
    { id: 'default', cnpj: CNPJ_A, is_default: true,  is_active: true },
    { id: 'second',  cnpj: CNPJ_B, is_default: false, is_active: true },
  ];

  it('blocks deactivating the default company', () => {
    expect(canDeactivate(companies, 'default')).toBe(false);
  });

  it('allows deactivating a non-default company when another remains active', () => {
    expect(canDeactivate(companies, 'second')).toBe(true);
  });

  it('blocks deactivating the last active company, even if not default', () => {
    const onlyOneActive: CompanyLike[] = [
      { id: 'default', cnpj: CNPJ_A, is_default: true,  is_active: false },
      { id: 'second',  cnpj: CNPJ_B, is_default: false, is_active: true  },
    ];
    expect(canDeactivate(onlyOneActive, 'second')).toBe(false);
  });

  it('is a no-op (false) for an unknown company id', () => {
    expect(canDeactivate(companies, 'ghost')).toBe(false);
  });

  it('allows deactivating an already-inactive non-default company (idempotent)', () => {
    const companiesWithInactive: CompanyLike[] = [
      { id: 'default', cnpj: CNPJ_A, is_default: true,  is_active: true },
      { id: 'second',  cnpj: CNPJ_B, is_default: false, is_active: false },
    ];
    expect(canDeactivate(companiesWithInactive, 'second')).toBe(true);
  });
});

describe('validateNewCompanyCnpj', () => {
  it('rejects an invalid CNPJ', () => {
    const result = validateNewCompanyCnpj([], '11111111111111');
    expect(result).toEqual({ ok: false, error: 'invalid_cnpj' });
  });

  it('rejects a CNPJ that already exists for the tenant (normalized comparison)', () => {
    const result = validateNewCompanyCnpj([CNPJ_A], '  aaaaaa00000171  '.trim());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('duplicate_cnpj');
  });

  it('rejects duplicate even with different punctuation/casing', () => {
    const result = validateNewCompanyCnpj(['AA.AAAA.000-00171'.replace(/[.\-]/g, '')], CNPJ_A);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('duplicate_cnpj');
  });

  it('accepts a valid, non-duplicate CNPJ', () => {
    const result = validateNewCompanyCnpj([CNPJ_A], CNPJ_B);
    expect(result).toEqual({ ok: true });
  });

  it('accepts the first company for a tenant with no existing CNPJs', () => {
    const result = validateNewCompanyCnpj([], CNPJ_C);
    expect(result).toEqual({ ok: true });
  });
});
