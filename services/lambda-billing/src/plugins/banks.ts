import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { BoletoAdapter } from '../adapters/index';
import type { BankingConfig } from '../lib/types';
import { ItauAdapter } from '../adapters/itau';
import { C6Adapter, type C6Credentials } from '../adapters/c6';

declare module 'fastify' {
  interface FastifyInstance {
    getAdapter(bankCode: string, banking: BankingConfig): BoletoAdapter;
  }
}

const BANK_ITAU = '341';
const BANK_C6   = '336';

const banksPlugin: FastifyPluginAsync = async (app) => {
  // Cache só faz sentido pro Itaú: um único app OAuth compartilhado da
  // plataforma (app.config), o mesmo adapter serve qualquer tenant. O C6 é
  // por TENANT (credenciais vêm de `banking.credentials`, diferentes a cada
  // mensagem) — não há o que cachear entre invocações distintas, e a Lambda
  // já processa uma mensagem por invocação (batch_size=1, ver terraform);
  // um C6Adapter novo por chamada é o comportamento correto, não uma
  // limitação a ser otimizada depois.
  const itauAdapterCache = new Map<string, BoletoAdapter>();

  app.decorate('getAdapter', (bankCode: string, banking: BankingConfig): BoletoAdapter => {
    switch (bankCode) {
      case BANK_ITAU: {
        if (itauAdapterCache.has(bankCode)) return itauAdapterCache.get(bankCode)!;
        const adapter = new ItauAdapter(
          app.config.itauClientId,
          app.config.itauClientSecret,
          app.config.itauBaseUrl,
          app.config.itauAuthUrl,
        );
        itauAdapterCache.set(bankCode, adapter);
        return adapter;
      }

      case BANK_C6:
        return new C6Adapter(
          (banking.credentials ?? {}) as unknown as C6Credentials,
          app.config.c6BaseUrl,
          app.config.c6AuthUrl,
        );

      default:
        throw new Error(
          `Banco ${bankCode} não suportado. Bancos suportados: ${BANK_ITAU} (Itaú), ${BANK_C6} (C6 Bank). ` +
          'Outros bancos serão adicionados em versões futuras.'
        );
    }
  });
};

export default fp(banksPlugin, { name: 'banks', dependencies: ['config'] });
