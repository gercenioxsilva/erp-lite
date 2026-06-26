// Types for billing/boleto messaging (SQS)

export interface BankingConfig {
  bank_code: string;
  agency: string;
  account: string;
  account_digit: string;
  billing_provider: string;
  billing_days_to_expire: number;
  itau_client_id?: string | null;
  itau_client_secret?: string | null;
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
