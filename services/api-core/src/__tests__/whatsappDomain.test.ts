import { describe, it, expect } from 'vitest';
import {
  toE164BR, interpolateTemplate, isOptOutReply, assertCanSend, assertValidAutomationConfig,
  assertProviderCredentials, verifyTwilioSignature, WhatsAppDomainError,
} from '../domain/whatsapp/whatsappDomain';
import { createHmac } from 'crypto';

describe('toE164BR', () => {
  it('converts an 11-digit local number (with DDD) to E.164', () => {
    expect(toE164BR('11999998888')).toBe('+5511999998888');
  });
  it('converts a 10-digit local number (landline) to E.164', () => {
    expect(toE164BR('1133334444')).toBe('+551133334444');
  });
  it('accepts a number already carrying the 55 country code', () => {
    expect(toE164BR('5511999998888')).toBe('+5511999998888');
  });
  it('strips punctuation before normalizing', () => {
    expect(toE164BR('(11) 99999-8888')).toBe('+5511999998888');
  });
  it('rejects a number with an invalid digit count', () => {
    expect(toE164BR('12345')).toBeNull();
  });
  it('rejects a 12/13-digit number that does not start with 55', () => {
    expect(toE164BR('12119999888899')).toBeNull();
  });
  it('returns null for empty/null input', () => {
    expect(toE164BR(null)).toBeNull();
    expect(toE164BR('')).toBeNull();
  });
});

describe('interpolateTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(interpolateTemplate('Olá, {{name}}! Valor: {{amount}}', { name: 'João', amount: 'R$ 10' }))
      .toBe('Olá, João! Valor: R$ 10');
  });
  it('replaces an unknown placeholder with an empty string, never leaves it raw', () => {
    expect(interpolateTemplate('Olá, {{name}}', {})).toBe('Olá, ');
  });
});

describe('isOptOutReply', () => {
  it('matches the exact word SAIR, case-insensitive', () => {
    expect(isOptOutReply('sair')).toBe(true);
    expect(isOptOutReply('SAIR')).toBe(true);
    expect(isOptOutReply('  Sair  ')).toBe(true);
  });
  it('tolerates trailing punctuation', () => {
    expect(isOptOutReply('sair!')).toBe(true);
  });
  it('does not match a free-form sentence containing the word', () => {
    expect(isOptOutReply('quero sair da lista')).toBe(false);
  });
  it('does not match unrelated text', () => {
    expect(isOptOutReply('obrigado')).toBe(false);
  });
  it('returns false for empty/null', () => {
    expect(isOptOutReply(null)).toBe(false);
    expect(isOptOutReply('')).toBe(false);
  });
});

describe('assertCanSend', () => {
  const validCtx = {
    accountStatus: 'connected', templateStatus: 'approved', automationEnabled: true,
    clientOptIn: true, phone: '+5511999998888',
  };

  it('does not throw when every condition is met', () => {
    expect(() => assertCanSend(validCtx)).not.toThrow();
  });
  it('throws account_not_connected when the account is not connected', () => {
    expect(() => assertCanSend({ ...validCtx, accountStatus: 'pending' }))
      .toThrow(expect.objectContaining({ code: 'account_not_connected' }));
  });
  it('throws template_not_approved when the template is not approved', () => {
    expect(() => assertCanSend({ ...validCtx, templateStatus: 'pending_approval' }))
      .toThrow(expect.objectContaining({ code: 'template_not_approved' }));
  });
  it('throws automation_disabled when the automation is off', () => {
    expect(() => assertCanSend({ ...validCtx, automationEnabled: false }))
      .toThrow(expect.objectContaining({ code: 'automation_disabled' }));
  });
  it('throws client_not_opted_in when the client has not consented', () => {
    expect(() => assertCanSend({ ...validCtx, clientOptIn: false }))
      .toThrow(expect.objectContaining({ code: 'client_not_opted_in' }));
  });
  it('throws invalid_phone when the phone is null', () => {
    expect(() => assertCanSend({ ...validCtx, phone: null }))
      .toThrow(expect.objectContaining({ code: 'invalid_phone' }));
  });
});

describe('assertValidAutomationConfig', () => {
  it('accepts a valid days_before for invoice_due_soon', () => {
    expect(() => assertValidAutomationConfig('invoice_due_soon', { days_before: 3 })).not.toThrow();
  });
  it('rejects invoice_due_soon without a valid days_before', () => {
    expect(() => assertValidAutomationConfig('invoice_due_soon', {})).toThrow(WhatsAppDomainError);
    expect(() => assertValidAutomationConfig('invoice_due_soon', { days_before: 0 })).toThrow(WhatsAppDomainError);
    expect(() => assertValidAutomationConfig('invoice_due_soon', { days_before: 31 })).toThrow(WhatsAppDomainError);
  });
  it('accepts a valid days_after for invoice_overdue', () => {
    expect(() => assertValidAutomationConfig('invoice_overdue', { days_after: 5 })).not.toThrow();
  });
  it('rejects invoice_overdue without a valid days_after', () => {
    expect(() => assertValidAutomationConfig('invoice_overdue', {})).toThrow(WhatsAppDomainError);
  });
  it('event-triggered templates require no config at all', () => {
    expect(() => assertValidAutomationConfig('payment_confirmed', {})).not.toThrow();
    expect(() => assertValidAutomationConfig('fiscal_document_authorized', {})).not.toThrow();
    expect(() => assertValidAutomationConfig('proposal_sent', {})).not.toThrow();
  });
});

describe('assertProviderCredentials', () => {
  it('accepts complete Twilio credentials', () => {
    expect(() => assertProviderCredentials('twilio', { account_sid: 'AC123', auth_token: 'tok123' })).not.toThrow();
  });
  it('rejects Twilio credentials missing auth_token', () => {
    expect(() => assertProviderCredentials('twilio', { account_sid: 'AC123' })).toThrow(WhatsAppDomainError);
  });
  it('rejects an unsupported provider', () => {
    expect(() => assertProviderCredentials('360dialog', {})).toThrow(expect.objectContaining({ code: 'unsupported_provider' }));
  });
});

describe('verifyTwilioSignature', () => {
  const url = 'https://app.example.com/v1/public/whatsapp/webhook';
  const authToken = 'test-auth-token';
  const params = { MessageSid: 'SM123', MessageStatus: 'delivered', To: 'whatsapp:+5511999998888' };

  function sign(u: string, p: Record<string, string>, token: string): string {
    const data = Object.keys(p).sort().reduce((acc, key) => acc + key + p[key], u);
    return createHmac('sha1', token).update(data, 'utf8').digest('base64');
  }

  it('accepts a correctly signed request', () => {
    const signature = sign(url, params, authToken);
    expect(verifyTwilioSignature(url, params, signature, authToken)).toBe(true);
  });
  it('rejects a request signed with the wrong auth token', () => {
    const signature = sign(url, params, 'wrong-token');
    expect(verifyTwilioSignature(url, params, signature, authToken)).toBe(false);
  });
  it('rejects a tampered payload (signature no longer matches)', () => {
    const signature = sign(url, params, authToken);
    expect(verifyTwilioSignature(url, { ...params, MessageStatus: 'failed' }, signature, authToken)).toBe(false);
  });
  it('rejects when the signature header is missing', () => {
    expect(verifyTwilioSignature(url, params, undefined, authToken)).toBe(false);
  });
});
