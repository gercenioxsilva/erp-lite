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

  await app.register(configPlugin);
  await app.register(awsPlugin);
  await app.register(focusNfePlugin);

  return app;
}
