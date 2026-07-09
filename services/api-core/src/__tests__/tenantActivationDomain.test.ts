import { describe, it, expect } from 'vitest';
import {
  TenantActivationDomainError, assertTokenValid, assertCanResendVerification,
} from '../domain/tenantActivation/tenantActivationDomain';

describe('assertTokenValid', () => {
  it('aceita um token com expiração no futuro', () => {
    const future = new Date(Date.now() + 60_000);
    expect(() => assertTokenValid(future, new Date())).not.toThrow();
  });

  it('rejeita um token expirado', () => {
    const past = new Date(Date.now() - 1000);
    expect(() => assertTokenValid(past, new Date())).toThrow(TenantActivationDomainError);
  });

  it('rejeita quando não há expiração nenhuma (nunca gerado) — fail-closed', () => {
    expect(() => assertTokenValid(null, new Date())).toThrow(TenantActivationDomainError);
  });

  it('erro carrega o código correto', () => {
    try {
      assertTokenValid(null);
    } catch (e) {
      expect(e).toBeInstanceOf(TenantActivationDomainError);
      expect((e as TenantActivationDomainError).code).toBe('verification_token_invalid_or_expired');
    }
  });
});

describe('assertCanResendVerification', () => {
  it('libera quando nunca foi reenviado antes (lastSentAt nulo)', () => {
    expect(() => assertCanResendVerification(null, new Date())).not.toThrow();
  });

  it('bloqueia dentro do cooldown', () => {
    const now = new Date();
    const justSent = new Date(now.getTime() - 10_000); // 10s atrás
    expect(() => assertCanResendVerification(justSent, now, 60)).toThrow(TenantActivationDomainError);
  });

  it('libera depois que o cooldown passa', () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - 120_000); // 2min atrás
    expect(() => assertCanResendVerification(longAgo, now, 60)).not.toThrow();
  });

  it('erro carrega quantos segundos faltam', () => {
    const now = new Date();
    const justSent = new Date(now.getTime() - 10_000);
    try {
      assertCanResendVerification(justSent, now, 60);
    } catch (e) {
      expect((e as TenantActivationDomainError).code).toBe('resend_cooldown_active');
      expect((e as TenantActivationDomainError).payload?.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});
