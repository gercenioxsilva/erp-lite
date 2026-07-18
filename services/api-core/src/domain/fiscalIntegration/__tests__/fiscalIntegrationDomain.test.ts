import { describe, it, expect } from 'vitest';
import {
  assertCanRegister, assertCanUploadCertificate, assertCanTestConnection,
  validateCertificateUpload, deriveFiscalIntegrationStatus,
  FiscalIntegrationDomainError,
} from '../fiscalIntegrationDomain';

describe('assertCanRegister', () => {
  it('allows when never attempted (null) or a previous attempt errored', () => {
    expect(() => assertCanRegister(null)).not.toThrow();
    expect(() => assertCanRegister('error')).not.toThrow();
    expect(() => assertCanRegister('registered')).not.toThrow();
  });

  it('blocks while a registration is already in flight', () => {
    expect(() => assertCanRegister('pending')).toThrow(FiscalIntegrationDomainError);
    expect(() => assertCanRegister('processing')).toThrow(FiscalIntegrationDomainError);
  });
});

describe('assertCanUploadCertificate / assertCanTestConnection', () => {
  it('requires the company to already be registered', () => {
    expect(() => assertCanUploadCertificate(null)).toThrow(FiscalIntegrationDomainError);
    expect(() => assertCanUploadCertificate(undefined)).toThrow(FiscalIntegrationDomainError);
    expect(() => assertCanUploadCertificate('ref-1')).not.toThrow();

    expect(() => assertCanTestConnection(null)).toThrow(FiscalIntegrationDomainError);
    expect(() => assertCanTestConnection('ref-1')).not.toThrow();
  });
});

describe('validateCertificateUpload', () => {
  it('requires both file and password', () => {
    expect(() => validateCertificateUpload({ certificado_base64: '', senha_certificado: 'x' }))
      .toThrow(FiscalIntegrationDomainError);
    expect(() => validateCertificateUpload({ certificado_base64: 'abc', senha_certificado: '' }))
      .toThrow(FiscalIntegrationDomainError);
  });

  it('rejects an oversized file', () => {
    const huge = 'a'.repeat(15_000_001);
    expect(() => validateCertificateUpload({ certificado_base64: huge, senha_certificado: 'x' }))
      .toThrow(FiscalIntegrationDomainError);
  });

  it('accepts a valid input', () => {
    expect(() => validateCertificateUpload({ certificado_base64: 'YWJj', senha_certificado: 'segredo' }))
      .not.toThrow();
  });
});

describe('deriveFiscalIntegrationStatus', () => {
  const now = new Date('2026-07-16T12:00:00Z');

  it('not_registered when never attempted', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: null, fiscal_registration_status: null, certificado_valido_ate: null,
    }, now)).toBe('not_registered');
  });

  it('pending while registration is in flight', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: null, fiscal_registration_status: 'processing', certificado_valido_ate: null,
    }, now)).toBe('pending');
  });

  it('error when the last registration attempt failed', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: null, fiscal_registration_status: 'error', certificado_valido_ate: null,
    }, now)).toBe('error');
  });

  it('registered_no_certificate when registered but no certificate uploaded yet', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: 'ref-1', fiscal_registration_status: 'registered', certificado_valido_ate: null,
    }, now)).toBe('registered_no_certificate');
  });

  it('active when certificate is valid well into the future', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: 'ref-1', fiscal_registration_status: 'registered', certificado_valido_ate: '2027-01-01',
    }, now)).toBe('active');
  });

  it('certificate_expiring_soon within 30 days of expiry', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: 'ref-1', fiscal_registration_status: 'registered', certificado_valido_ate: '2026-08-01',
    }, now)).toBe('certificate_expiring_soon');
  });

  it('certificate_expired when the expiry date is in the past', () => {
    expect(deriveFiscalIntegrationStatus({
      fiscal_integration_ref: 'ref-1', fiscal_registration_status: 'registered', certificado_valido_ate: '2026-01-01',
    }, now)).toBe('certificate_expired');
  });
});
