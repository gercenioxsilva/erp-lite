// Domínio de Faturamento de Ordem de Serviço — regras de negócio puras, sem
// I/O. Segue o mesmo padrão de serviceOrderDomain.ts/supplierInvoiceDomain.ts.

export class ServiceOrderBillingDomainError extends Error {
  constructor(public code: string, public payload?: Record<string, unknown>) {
    super(code);
    this.name = 'ServiceOrderBillingDomainError';
  }
}

/**
 * Só é possível faturar uma OS concluída, e no máximo uma vez — a trava real
 * de idempotência é o UNIQUE parcial em receivables.service_order_id
 * (migration 0052); esta função só dá o erro cedo, com mensagem clara, antes
 * de bater no banco.
 */
export function assertCanBillServiceOrder(status: string, alreadyBilled: boolean): void {
  if (status !== 'completed') {
    throw new ServiceOrderBillingDomainError('service_order_not_completed', { status });
  }
  if (alreadyBilled) {
    throw new ServiceOrderBillingDomainError('service_order_already_billed');
  }
}

/** Vencimento sugerido: N dias a partir de agora (default 7), editável pelo usuário no confirm. */
export function defaultBillingDueDate(daysFromNow = 7, now: Date = new Date()): string {
  const dt = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}
