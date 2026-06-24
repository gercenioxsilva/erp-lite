import type { BankingConfig, BoletoResult } from '../lib/types';

export interface BoletoPayload {
  amount:        number;
  due_date:      string;   // YYYY-MM-DD
  description:   string;
  days_to_expire: number;
  banking:       BankingConfig;
}

/** Contract every bank adapter must fulfil */
export interface BoletoAdapter {
  emit(payload: BoletoPayload): Promise<BoletoResult>;
}
