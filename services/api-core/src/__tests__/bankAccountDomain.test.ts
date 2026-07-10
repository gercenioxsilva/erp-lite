import { describe, it, expect } from 'vitest';
import {
  canDeactivate, assertItauCredentials, assertC6Credentials, assertProviderCredentials,
  BankAccountDomainError, type BankAccountLike,
} from '../domain/bankAccount/bankAccountDomain';

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

describe('assertItauCredentials', () => {
  it('accepts client_id + client_secret', () => {
    expect(() => assertItauCredentials({ client_id: 'a', client_secret: 'b' })).not.toThrow();
  });

  it('rejects missing client_secret', () => {
    expect(() => assertItauCredentials({ client_id: 'a' })).toThrow(BankAccountDomainError);
  });

  it('rejects null credentials', () => {
    expect(() => assertItauCredentials(null)).toThrow(BankAccountDomainError);
  });

  it('error payload lists exactly which keys are missing', () => {
    try {
      assertItauCredentials({ client_id: '' });
    } catch (e) {
      expect((e as BankAccountDomainError).code).toBe('invalid_credentials');
      expect((e as BankAccountDomainError).payload).toMatchObject({ provider: 'itau', missing: ['client_id', 'client_secret'] });
    }
  });
});

describe('assertC6Credentials', () => {
  it('accepts client_id + client_secret + cert + key', () => {
    expect(() => assertC6Credentials({
      client_id: 'a', client_secret: 'b', cert: '-----BEGIN CERTIFICATE-----', key: '-----BEGIN PRIVATE KEY-----',
    })).not.toThrow();
  });

  it('rejects when cert/key are missing (C6 exige mTLS, diferente do Itaú)', () => {
    expect(() => assertC6Credentials({ client_id: 'a', client_secret: 'b' })).toThrow(BankAccountDomainError);
  });

  it('error payload lists cert/key among the missing keys', () => {
    try {
      assertC6Credentials({ client_id: 'a', client_secret: 'b' });
    } catch (e) {
      expect((e as BankAccountDomainError).payload).toMatchObject({ provider: 'c6', missing: ['cert', 'key'] });
    }
  });
});

describe('assertProviderCredentials', () => {
  it('dispatches to the itau validator', () => {
    expect(() => assertProviderCredentials('itau', {})).toThrow(BankAccountDomainError);
  });

  it('dispatches to the c6 validator', () => {
    expect(() => assertProviderCredentials('c6', { client_id: 'a', client_secret: 'b' })).toThrow(BankAccountDomainError);
  });

  it('is a no-op for providers without a credential contract yet (brcode/santander/bradesco)', () => {
    expect(() => assertProviderCredentials('brcode', null)).not.toThrow();
    expect(() => assertProviderCredentials('santander', null)).not.toThrow();
  });
});
