import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { BoletoAdapter } from '../adapters/index';
import { ItauAdapter } from '../adapters/itau';

declare module 'fastify' {
  interface FastifyInstance {
    getAdapter(bankCode: string): BoletoAdapter;
  }
}

const BANK_ITAU = '341';

const banksPlugin: FastifyPluginAsync = async (app) => {
  const adapterCache = new Map<string, BoletoAdapter>();

  app.decorate('getAdapter', (bankCode: string): BoletoAdapter => {
    if (adapterCache.has(bankCode)) return adapterCache.get(bankCode)!;

    let adapter: BoletoAdapter;

    switch (bankCode) {
      case BANK_ITAU:
        adapter = new ItauAdapter(
          app.config.itauClientId,
          app.config.itauClientSecret,
          app.config.itauBaseUrl,
          app.config.itauAuthUrl,
        );
        break;

      default:
        throw new Error(
          `Banco ${bankCode} não suportado. Bancos suportados: ${BANK_ITAU} (Itaú). ` +
          'Outros bancos serão adicionados em versões futuras.'
        );
    }

    adapterCache.set(bankCode, adapter);
    return adapter;
  });
};

export default fp(banksPlugin, { name: 'banks', dependencies: ['config'] });
