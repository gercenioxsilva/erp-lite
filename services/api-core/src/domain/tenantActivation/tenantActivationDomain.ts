// Domínio de Ativação de Conta por E-mail — regras de negócio puras, sem
// I/O. Segue o mesmo padrão de Clean Architecture já usado em
// payrollDomain.ts/accessControlDomain.ts.

export class TenantActivationDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'TenantActivationDomainError';
  }
}

/** Token de verificação — expira em 48h (mesma janela já usada pelo
 * convite de técnico). `expiresAt` nulo conta como "nunca gerado", nunca
 * como "sempre válido" — fail-closed por padrão. */
export function assertTokenValid(expiresAt: Date | null, now: Date = new Date()): void {
  if (!expiresAt || expiresAt <= now) {
    throw new TenantActivationDomainError('verification_token_invalid_or_expired');
  }
}

/** Cooldown curto contra clique duplo/spam no botão de reenvio — proteção
 * barata, não é um rate-limit pesado. `lastSentAt` nulo (nunca reenviado
 * antes) sempre libera. */
export function assertCanResendVerification(
  lastSentAt: Date | null, now: Date = new Date(), cooldownSeconds = 60,
): void {
  if (!lastSentAt) return;
  const elapsedMs = now.getTime() - lastSentAt.getTime();
  if (elapsedMs < cooldownSeconds * 1000) {
    throw new TenantActivationDomainError('resend_cooldown_active', {
      retryAfterSeconds: Math.ceil((cooldownSeconds * 1000 - elapsedMs) / 1000),
    });
  }
}
