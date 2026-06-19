import Fastify, { type FastifyInstance } from 'fastify';
import configPlugin from './plugins/config';
import awsPlugin from './plugins/aws';
import focusNfePlugin from './plugins/focusNfe';

export type App = FastifyInstance;

export async function buildApp(): Promise<App> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // pino outputs JSON lines — compatible with CloudWatch Logs Insights
      formatters: { level: (label) => ({ level: label }) },
    },
  });

  // Register all plugins without await — fp() + dependencies[] guarantees
  // initialization order (config → aws, config → focusNfe).
  // A single app.ready() initializes the full chain at once.
  app.register(configPlugin);
  app.register(awsPlugin);
  app.register(focusNfePlugin);

  await app.ready();
  return app;
}
