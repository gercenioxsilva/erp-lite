import type {
  MarketplaceConnectionTokens, MarketplaceSyncRequestMessage, RefreshedTokens, MlOrder,
} from '../lib/types';

export interface SyncMaterialOutcome {
  status: 'active' | 'error';
  error_reason?: string;
  refreshed_tokens?: RefreshedTokens;
}

export interface FetchResourceOutcome {
  /** null quando o tópico do webhook não é suportado nesta fase (ex.: perguntas, itens) — ignorar em silêncio. */
  ml_order: MlOrder | null;
  refreshed_tokens?: RefreshedTokens;
}

/** Contrato que qualquer adapter de marketplace precisa cumprir. */
export interface MarketplaceAdapter {
  syncMaterial(msg: MarketplaceSyncRequestMessage): Promise<SyncMaterialOutcome>;
  fetchResource(msg: MarketplaceSyncRequestMessage): Promise<FetchResourceOutcome>;
}

export type { MarketplaceConnectionTokens };
