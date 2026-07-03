import { describe, it, expect } from 'vitest';
import { canDeactivate, type BankAccountLike } from '../domain/bankAccount/bankAccountDomain';

describe('canDeactivate', () => {
  const accounts: BankAccountLike[] = [
    { id: 'acc-default', company_id: 'company-a', is_default: true,  is_active: true },
    { id: 'acc-second',  company_id: 'company-a', is_default: false, is_active: true },
    { id: 'acc-other-company', company_id: 'company-b', is_default: true, is_active: true },
  ];

  it('blocks deactivating the default account of a company', () => {
    expect(canDeactivate(accounts, 'acc-default')).toBe(false);
  });

  it('allows deactivating a non-default account when another remains active in the same company', () => {
    expect(canDeactivate(accounts, 'acc-second')).toBe(true);
  });

  it('blocks deactivating the last active account of a company, even if not default', () => {
    const onlyOneActive: BankAccountLike[] = [
      { id: 'acc-default', company_id: 'company-a', is_default: true,  is_active: false },
      { id: 'acc-second',  company_id: 'company-a', is_default: false, is_active: true  },
    ];
    expect(canDeactivate(onlyOneActive, 'acc-second')).toBe(false);
  });

  it('does not let another company\'s active accounts count toward this company\'s invariant', () => {
    const onePerCompany: BankAccountLike[] = [
      { id: 'acc-a', company_id: 'company-a', is_default: false, is_active: true },
      { id: 'acc-b', company_id: 'company-b', is_default: true,  is_active: true },
    ];
    // acc-a is the only active account of company-a, even though company-b has one too
    expect(canDeactivate(onePerCompany, 'acc-a')).toBe(false);
  });

  it('is a no-op (false) for an unknown account id', () => {
    expect(canDeactivate(accounts, 'ghost')).toBe(false);
  });

  it('allows deactivating an already-inactive non-default account (idempotent)', () => {
    const withInactive: BankAccountLike[] = [
      { id: 'acc-default', company_id: 'company-a', is_default: true,  is_active: true },
      { id: 'acc-second',  company_id: 'company-a', is_default: false, is_active: false },
    ];
    expect(canDeactivate(withInactive, 'acc-second')).toBe(true);
  });
});
