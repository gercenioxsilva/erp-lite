// Domínio de NFS-e — regras de negócio puras, sem I/O. Mesmo padrão de
// Clean Architecture já usado em purchaseOrderDomain.ts/serviceOrderDomain.ts.

// issRatePct é percentual (ex.: 5 = 5%), mesma convenção de
// nfse_invoices.iss_rate — extraído de serviceOrderBillingService.ts, que
// calculava o mesmo valor inline.
export function calcIssValue(amount: number, issRatePct: number): number {
  return Math.round(amount * issRatePct) / 100;
}
