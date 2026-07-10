// Types for billing/boleto messaging (SQS)

export interface BankingConfig {
  bank_code: string;
  agency: string;
  account: string;
  account_digit: string;
  billing_provider: string;
  billing_days_to_expire: number;
  /** @deprecated ver `credentials` — mantido só por compatibilidade de mensagens já em voo. */
  itau_client_id?: string | null;
  /** @deprecated ver `credentials`. */
  itau_client_secret?: string | null;
  /** Genérico por provedor (migration 0064) — {client_id, client_secret} pro
   *  Itaú, {client_id, client_secret, cert, key} pro C6. Único campo que o
   *  lambda-billing deveria ler daqui em diante: credenciais são POR TENANT
   *  (cada tenant usa a própria conta C6/Itaú), nunca um app compartilhado
   *  da plataforma — diferente do env var ITAU_CLIENT_ID/SECRET legado do
   *  Lambda, que hoje serve todos os tenants com o mesmo app. */
  credentials?: Record<string, string> | null;
}

export interface BillingEmitMessage {
  boleto_id: string;        // draft boleto record ID for idempotency
  receivable_id: string;
  tenant_id: string;
  amount: string;           // Decimal stored as string
  due_date: string;         // ISO date: YYYY-MM-DD
  description: string;
  days_to_expire: number;
  banking: BankingConfig;
}

export interface BillingResultMessage {
  boleto_id: string;        // draft boleto record ID to update
  receivable_id: string;
  tenant_id: string;
  boleto_status: 'generated' | 'error';

  // On success
  external_id?: string;     // ID in the bank's system
  brcode?: string;          // barcode / PIX copy-paste
  pix_qr_code?: string;     // SVG/URL for QR code
  nosso_numero?: string;    // bank's sequential number
  boleto_url?: string;      // public payment / PDF link
  pdf_s3_key?: string;      // PDF stored in S3
  issued_at?: string;
  expires_at?: string;

  // On error
  error_reason?: string;
}
