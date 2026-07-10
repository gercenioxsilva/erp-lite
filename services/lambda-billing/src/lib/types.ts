// Types for billing Lambda — mirrors api-core/src/lib/billing-types.ts
// Each Lambda workspace is independent; types are duplicated intentionally.

export interface BankingConfig {
  bank_code: string;
  agency: string;
  account: string;
  account_digit: string;
  billing_provider: string;
  billing_days_to_expire: number;
  /** Genérico por provedor (migration 0064, api-core) — {client_id,
   *  client_secret} pro Itaú, {client_id, client_secret, cert, key} pro C6.
   *  Por tenant: cada tenant usa a própria credencial (diferente do Itaú
   *  hoje, que usa um app compartilhado via env var da própria Lambda —
   *  ver plugins/config.ts). */
  credentials?: Record<string, string> | null;
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
