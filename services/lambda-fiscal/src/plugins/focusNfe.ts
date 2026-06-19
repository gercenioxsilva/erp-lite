import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { FocusNfeClient } from '../lib/focusNfe';

declare module 'fastify' {
  interface FastifyInstance {
    getFocusClient: (ambiente: 1 | 2) => FocusNfeClient;
  }
}

const focusNfePlugin: FastifyPluginAsync = async (app) => {
  const cache = new Map<1 | 2, FocusNfeClient>();

  app.decorate('getFocusClient', (ambiente: 1 | 2): FocusNfeClient => {
    let client = cache.get(ambiente);
    if (!client) {
      client = new FocusNfeClient(app.config.focusToken, ambiente);
      cache.set(ambiente, client);
    }
    return client;
  });
};

export default fp(focusNfePlugin, { name: 'focusNfe', dependencies: ['config'] });
