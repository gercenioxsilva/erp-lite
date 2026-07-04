import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { MercadoLivreAdapter } from '../adapters/mercadolivre';
import type { MarketplaceAdapter } from '../adapters';

declare module 'fastify' {
  interface FastifyInstance {
    getMarketplaceAdapter(): MarketplaceAdapter;
  }
}

// Instanciação preguiçosa (mesmo padrão de getAdapter() em lambda-billing/
// plugins/banks.ts) — se MERCADO_LIVRE_CLIENT_ID/SECRET ainda não estiverem
// configurados (app aguardando aprovação/cadastro no Mercado Livre), o Lambda
// sobe normalmente e só falha ao processar uma mensagem de verdade, nunca no boot.
const marketplaceAdapterPlugin: FastifyPluginAsync = async (app) => {
  let cached: MarketplaceAdapter | null = null;

  app.decorate('getMarketplaceAdapter', (): MarketplaceAdapter => {
    if (!cached) {
      cached = new MercadoLivreAdapter(
        app.config.mercadoLivreClientId,
        app.config.mercadoLivreClientSecret,
        app.config.mercadoLivreApiBaseUrl,
        app.config.mercadoLivreTokenUrl,
      );
    }
    return cached;
  });
};

export default fp(marketplaceAdapterPlugin, { name: 'marketplaceAdapter', dependencies: ['config'] });
