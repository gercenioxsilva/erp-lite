// Types for billing Lambda — mirrors api-core/src/lib/billing-types.ts
// Each Lambda workspace is independent; types are duplicated intentionally.

export interface BankingConfig {
  bank_code: string;
  agency: string;
  account: string;
  account_digit: string;
  billing_provider: string;
  billing_days_to_expire: number;
}

export interface BillingEmitMessage {
  boleto_id: string;
  receivable_id: string;
  tenant_id: string;
  amount: string;
  due_date: string;         // YYYY-MM-DD
  description: string;
  days_to_expire: number;
  banking: BankingConfig;
}

export interface BillingResultMessage {
  boleto_id: string;
  receivable_id: string;
  tenant_id: string;
  boleto_status: 'generated' | 'error';

  // On success
  external_id?: string;
  brcode?: string;
  pix_qr_code?: string;
  nosso_numero?: string;
  boleto_url?: string;
  pdf_s3_key?: string;
  issued_at?: string;
  expires_at?: string;

  // On error
  error_reason?: string;
}

export interface BoletoResult {
  external_id: string;
  nosso_numero: string;
  brcode?: string;
  pix_qr_code?: string;
  boleto_url: string;
  pdf_s3_key?: string;
  issued_at: string;
  expires_at: string;
}
