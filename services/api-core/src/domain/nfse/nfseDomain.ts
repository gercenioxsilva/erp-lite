// Domínio de NFS-e — regras de negócio puras, sem I/O. Mesmo padrão de
// Clean Architecture já usado em purchaseOrderDomain.ts/serviceOrderDomain.ts.

export class NfseDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'NfseDomainError';
  }
}

export interface NfseCreateInput {
  clientId:    string;
  description: string;
  amount:      number;
  serviceCode: string;
  issRate:     number;
}

export function validateNfseCreate(input: NfseCreateInput): void {
  if (!input.clientId)              throw new NfseDomainError('nfse_client_required');
  if (!input.description?.trim())   throw new NfseDomainError('nfse_description_required');
  if (!(input.amount > 0))          throw new NfseDomainError('nfse_amount_invalid');
  if (!input.serviceCode?.trim())   throw new NfseDomainError('nfse_service_code_required');
  if (!(input.issRate >= 0))        throw new NfseDomainError('nfse_iss_rate_invalid');
}

// issRatePct é percentual (ex.: 5 = 5%), mesma convenção de
// nfse_invoices.iss_rate — extraído de serviceOrderBillingService.ts, que
// calculava o mesmo valor inline.
export function calcIssValue(amount: number, issRatePct: number): number {
  return Math.round(amount * issRatePct) / 100;
}
