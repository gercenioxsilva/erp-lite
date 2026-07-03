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
