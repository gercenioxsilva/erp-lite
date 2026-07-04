// Types for Mercado Livre marketplace sync Lambda — mirrors
// api-core/src/lib/marketplace-types.ts. Each Lambda workspace is independent;
// types are duplicated intentionally (mesmo padrão de lambda-billing/lib/types.ts).

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
  price?: string;
  available_quantity?: number;

  // fetch_resource
  topic?: string;
  resource?: string;
}

export interface RefreshedTokens {
  access_token: string;
  refresh_token: string;
  token_expires_at: string; // ISO timestamp
}

export interface MlOrderItem {
  ml_item_id: string;
  ml_variation_id?: string | null;
  quantity: number;
  unit_price: number;
  title?: string;
}

export interface MlOrder {
  id: string;
  items: MlOrderItem[];
}

export interface MarketplaceSyncResultMessage {
  type: 'order_import' | 'sync_material';
  tenant_id: string;
  connection_id: string;
  refreshed_tokens?: RefreshedTokens;

  // order_import
  ml_order?: MlOrder;

  // sync_material
  link_id?: string;
  status?: 'active' | 'error';
  error_reason?: string;
}
