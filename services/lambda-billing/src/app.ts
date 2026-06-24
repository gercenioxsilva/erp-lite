import Fastify, { type FastifyInstance } from 'fastify';
import configPlugin from './plugins/config';
import awsPlugin    from './plugins/aws';
import banksPlugin  from './plugins/banks';

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      formatters: { level: (label) => ({ level: label }) },
    },
  });

  // Register without await — fp() + dependencies[] guarantees order;
  // a single app.ready() initializes the full chain (config → aws, config → banks).
  app.register(configPlugin);
  app.register(awsPlugin);
  app.register(banksPlugin);

  await app.ready();
  return app;
}
