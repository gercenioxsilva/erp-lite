import Fastify, { type FastifyInstance } from 'fastify';
import configPlugin    from './plugins/config';
import sesPlugin       from './plugins/ses';
import templatesPlugin from './plugins/templates';

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      formatters: { level: (label) => ({ level: label }) },
    },
  });

  // Register without await — fp() + dependencies[] guarantees order;
  // single app.ready() initializes the full plugin chain.
  app.register(configPlugin);
  app.register(sesPlugin);
  app.register(templatesPlugin);

  await app.ready();
  return app;
}
