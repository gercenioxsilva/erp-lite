// Banking data validation and utilities for billing module

const VALID_BANK_CODES = {
  '001': 'Banco do Brasil',
  '033': 'Banco Santander',
  '104': 'Caixa Econômica Federal',
  '237': 'Bradesco',
  '336': 'C6 Bank',
  '341': 'Itaú Unibanco',
  '389': 'Banco Mercantil',
  '422': 'Banco Safra',
  '633': 'Banco Bradesco (Operações)',
  '655': 'Banco Votorantim',
  '745': 'Banco Citibank',
} as const;

export type BankCode = keyof typeof VALID_BANK_CODES;
export const BANK_CODES_LIST = Object.keys(VALID_BANK_CODES) as BankCode[];

export function getBankName(code: string): string {
  return VALID_BANK_CODES[code as BankCode] || 'Banco desconhecido';
}

export interface BankingData {
  bank_code?: string;
  agency?: string;
  account?: string;
  account_digit?: string;
}

/**
 * Validate banking data format and completeness.
 * @throws Error with descriptive message if validation fails
 */
export function validateBankingData(data: BankingData): void {
  const hasBankingData = data.bank_code || data.agency || data.account || data.account_digit;

  // If any field is provided, all must be provided
  if (hasBankingData) {
    if (!data.bank_code) {
      throw new Error('bank_code é obrigatório quando dados bancários são fornecidos');
    }
    if (!VALID_BANK_CODES[data.bank_code as BankCode]) {
      throw new Error(`bank_code '${data.bank_code}' inválido. Códigos válidos: ${BANK_CODES_LIST.join(', ')}`);
    }
    if (!data.agency) {
      throw new Error('agency é obrigatório quando dados bancários são fornecidos');
    }
    if (!/^\d{4,5}$/.test(data.agency)) {
      throw new Error('agency deve conter 4 ou 5 dígitos');
    }
    if (!data.account) {
      throw new Error('account é obrigatório quando dados bancários são fornecidos');
    }
    if (!/^\d{5,20}(-\d{1,2})?$/.test(data.account)) {
      throw new Error('account deve estar no formato NNNNN ou NNNNN-D');
    }
    if (!data.account_digit) {
      throw new Error('account_digit é obrigatório quando dados bancários são fornecidos');
    }
    if (!/^\d{1,2}$/.test(data.account_digit)) {
      throw new Error('account_digit deve conter 1 ou 2 dígitos');
    }
  }
}

/**
 * Validate account digit for Itaú (if needed in future).
 * Placeholder for digit verification logic.
 */
export function validateAccountDigitItau(account: string, digit: string): boolean {
  // TODO: Implement Itaú digit verification algorithm
  // For now, just ensure it's numeric
  return /^\d{1,2}$/.test(digit);
}

/**
 * Generate sequential nosso_numero for boleto (simple approach).
 * In production, would use database sequence or bank-provided number.
 */
export function generateNossoNumero(receivableId: string, sequence: number): string {
  // Format: NNNNNNNNNNNNNNNNNNNNN (20 digits max for Itaú)
  // Use receivable ID hash + sequence for uniqueness
  const hash = parseInt(receivableId.replace(/-/g, '').slice(-8), 16) % 1000000;
  return `${hash.toString().padStart(10, '0')}${sequence.toString().padStart(10, '0')}`.slice(-20);
}

/**
 * Format account for display (e.g., "16102-5" → "16.102-5")
 */
export function formatAccount(account: string): string {
  if (!account) return account;
  const parts = account.split('-');
  if (parts[0]?.length === 5) {
    return `${parts[0].slice(0, 2)}.${parts[0].slice(2)}-${parts[1] || ''}`;
  }
  return account;
}

/**
 * Valid billing providers (extensible for future integrations)
 */
export const BILLING_PROVIDERS = ['brcode', 'itau', 'c6', 'santander', 'bradesco'] as const;
export type BillingProvider = typeof BILLING_PROVIDERS[number];

export function isValidBillingProvider(provider: string): provider is BillingProvider {
  return BILLING_PROVIDERS.includes(provider as BillingProvider);
}
