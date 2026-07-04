// Types for Mercado Livre marketplace sync messaging (SQS) — Fase 2.
// Lambdas neste projeto nunca acessam o Postgres diretamente (mesmo padrão de
// BillingEmitMessage.banking) — por isso a mensagem de pedido carrega um
// snapshot dos tokens da conexão e dos dados do material que o
// lambda-marketplace vai precisar para chamar a API do Mercado Livre.

import type { MlOrder } from '../domain/marketplace/marketplaceDomain';

export interface MarketplaceConnectionTokens {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null; // ISO timestamp
}

export interface MarketplaceSyncRequestMessage {
  type: 'sync_material' | 'fetch_resource';
  tenant_id: string;
  connection_id: string;
  connection: MarketplaceConnectionTokens;

  // sync_material
  link_id?: string;
  ml_item_id?: string | null;
  ml_variation_id?: string | null;
  sync_price?: boolean;
  sync_stock?: boolean;
  price?: string;               // snapshot de materials.sale_price
  available_quantity?: number;  // snapshot de inventory.quantity

  // fetch_resource
  topic?: string;
  resource?: string;
}

export interface RefreshedTokens {
  access_token: string;
  refresh_token: string;
  token_expires_at: string; // ISO timestamp
}

export interface MarketplaceSyncResultMessage {
  type: 'order_import' | 'sync_material';
  tenant_id: string;
  connection_id: string;
  // O refresh_token do Mercado Livre é de uso único — sempre que o Lambda
  // renovar durante o processamento, o novo par precisa voltar aqui para o
  // worker persistir em marketplace_connections, senão a próxima chamada
  // usaria um refresh_token já invalidado.
  refreshed_tokens?: RefreshedTokens;

  // order_import
  ml_order?: MlOrder;

  // sync_material
  link_id?: string;
  status?: 'active' | 'error';
  error_reason?: string;
}
