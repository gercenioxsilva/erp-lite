// Domínio de Conta Bancária (múltiplas contas por empresa, regra 41) — puro, sem I/O.
// Validação de formato dos dados bancários já existe em lib/banking.ts
// (validateBankingData, isValidBillingProvider) — reaproveitada pelo serviço,
// não duplicada aqui. Este módulo só contém os invariantes de negócio novos.

export class BankAccountDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'BankAccountDomainError';
  }
}

export interface BankAccountLike {
  id:         string;
  company_id: string;
  is_default: boolean;
  is_active:  boolean;
}

/**
 * Uma conta não pode ser desativada se for a padrão da sua empresa, ou se for
 * a última conta ativa DAQUELA empresa (cada empresa precisa de ao menos uma
 * conta bancária ativa para continuar emitindo boleto/PIX) — o invariante é
 * por empresa, não por tenant, já que cada CNPJ tem suas próprias contas.
 */
export function canDeactivate(accounts: BankAccountLike[], accountId: string): boolean {
  const target = accounts.find(a => a.id === accountId);
  if (!target) return false;
  if (target.is_default) return false;

  const activeInSameCompany = accounts.filter(a => a.company_id === target.company_id && a.is_active);
  if (target.is_active && activeInSameCompany.length <= 1) return false;

  return true;
}

// ── Credenciais por provedor (migration 0064) ────────────────────────────────
// `bank_accounts.credentials` é uma coluna jsonb genérica — cada provedor tem
// seu próprio conjunto de chaves obrigatórias. Validado aqui (puro, sem I/O)
// em vez de no serviço, mesmo racional de `validateBankingData()` em
// lib/banking.ts continuar cuidando só do formato agência/conta/dígito.

export type BankCredentials = Record<string, string> | null | undefined;

function assertNonEmpty(credentials: BankCredentials, keys: string[], provider: string): void {
  const missing = keys.filter(k => !credentials?.[k]?.trim());
  if (missing.length > 0) {
    throw new BankAccountDomainError('invalid_credentials', { provider, missing });
  }
}

/** Itaú: OAuth2 client_credentials puro, sem certificado. */
export function assertItauCredentials(credentials: BankCredentials): void {
  assertNonEmpty(credentials, ['client_id', 'client_secret'], 'itau');
}

/**
 * C6: OAuth2 client_credentials + mTLS — exige, além de client_id/secret, o
 * par de certificado (.crt) e chave privada (.key) autogerados pelo próprio
 * tenant no PJ Internet Banking do C6 (12 meses de validade, sem exigir
 * ICP-Brasil). Sem o par cert/key não é possível nem trocar o token OAuth2
 * (o mTLS já se aplica na própria chamada de autenticação).
 */
export function assertC6Credentials(credentials: BankCredentials): void {
  assertNonEmpty(credentials, ['client_id', 'client_secret', 'cert', 'key'], 'c6');
}

/**
 * Despacha pro validador certo conforme o provedor — 'brcode' não exige
 * nenhuma credencial (é o valor default, sem integração bancária real
 * nenhuma). Provedores sem adapter implementado ainda (santander/bradesco)
 * não têm validação de credencial própria nesta v1 — cadastro é permitido,
 * só não há emissão de fato (mesmo estado de hoje).
 */
export function assertProviderCredentials(provider: string, credentials: BankCredentials): void {
  if (provider === 'itau') return assertItauCredentials(credentials);
  if (provider === 'c6')   return assertC6Credentials(credentials);
}
