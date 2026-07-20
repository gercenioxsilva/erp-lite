// Normalização Pluggy → imported_transactions — PURA (sem I/O). O contrato de
// saída é o MESMO do OFX (source='bank'): amount sinalizado (+crédito entra,
// −débito sai), memo com a descrição, e — vantagem sobre OFX — o paymentData
// do Open Finance traz nome/documento da contraparte, que alimentam
// customer_name/customer_document e melhoram o score da conciliação.

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string;                       // ISO
  description: string | null;
  amount: number;                     // Pluggy: sinalizado (débito negativo)
  type?: 'CREDIT' | 'DEBIT' | string; // redundante com o sinal — conferimos
  status?: string;                    // POSTED | PENDING
  category?: string | null;           // taxonomia Pluggy (ex.: 'Bank fees')
  paymentData?: {
    paymentMethod?: string | null;    // PIX | TED | DOC | BOLETO | ...
    payer?:    { name?: string | null; documentNumber?: { value?: string | null } | null } | null;
    receiver?: { name?: string | null; documentNumber?: { value?: string | null } | null } | null;
  } | null;
}

export interface NormalizedBankTx {
  source: 'bank';
  source_kind: 'openfinance';
  dedup_key: string;
  occurred_at: Date | null;
  bank_account_ref: string;
  memo: string | null;
  trn_type: string | null;
  amount: number;
  payment_method: string | null;
  category: string | null;
  customer_name: string | null;
  customer_document: string | null;
  raw: Record<string, unknown>;
}

export function dedupKeyForPluggy(accountId: string, txId: string): string {
  return `of:${accountId}:${txId}`;
}

const onlyDigits = (s: string | null | undefined): string | null => {
  const d = (s ?? '').replace(/\D/g, '');
  return d.length >= 11 && d.length <= 14 ? d : null;
};

/**
 * Converte 1 transação Pluggy na linha canônica do ledger de importação.
 * Crédito (dinheiro ENTRANDO) → contraparte = payer; débito → receiver.
 * Transações PENDING são puladas pelo caller (só POSTED entra no ledger —
 * pendente pode sumir do extrato e viraria lixo inconciliável).
 */
export function normalizePluggyTransaction(tx: PluggyTransaction): NormalizedBankTx {
  const amount = Number(tx.amount) || 0;
  const isCredit = amount > 0;
  const counterpart = isCredit ? tx.paymentData?.payer : tx.paymentData?.receiver;
  const method = tx.paymentData?.paymentMethod ?? null;

  return {
    source: 'bank',
    source_kind: 'openfinance',
    dedup_key: dedupKeyForPluggy(tx.accountId, tx.id),
    occurred_at: tx.date ? new Date(tx.date) : null,
    bank_account_ref: tx.accountId,
    memo: tx.description ?? null,
    trn_type: tx.type ?? (isCredit ? 'CREDIT' : 'DEBIT'),
    amount,
    payment_method: method ? method.toLowerCase() : null,
    category: tx.category ?? null,
    customer_name: counterpart?.name ?? null,
    customer_document: onlyDigits(counterpart?.documentNumber?.value),
    raw: tx as unknown as Record<string, unknown>,
  };
}

/** Janela do sync: 3 dias de overlap (o dedup absorve) ou 90 no 1º sync. */
export function syncWindowStart(lastSyncedAt: Date | null, now: Date): Date {
  const DAY = 86_400_000;
  if (!lastSyncedAt) return new Date(now.getTime() - 90 * DAY);
  return new Date(lastSyncedAt.getTime() - 3 * DAY);
}
