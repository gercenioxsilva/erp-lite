import Fastify, { type FastifyInstance } from 'fastify';
import configPlugin from './plugins/config';
import awsPlugin from './plugins/aws';
import marketplaceAdapterPlugin from './plugins/marketplaceAdapter';

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      formatters: { level: (label) => ({ level: label }) },
    },
  });

  app.register(configPlugin);
  app.register(awsPlugin);
  app.register(marketplaceAdapterPlugin);

  await app.ready();
  return app;
}
