import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface AppConfig {
  awsRegion:          string;
  focusToken:         string;
  nfeResultsQueueUrl: string;
  nfeBucket:          string;
}

declare module 'fastify' {
  interface FastifyInstance { config: AppConfig; }
}

const configPlugin: FastifyPluginAsync = async (app) => {
  const required = ['FOCUS_NFE_TOKEN', 'NFE_RESULTS_QUEUE_URL', 'NFE_BUCKET'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  app.decorate('config', {
    awsRegion:          process.env.AWS_REGION ?? 'us-east-1',
    focusToken:         process.env.FOCUS_NFE_TOKEN!,
    nfeResultsQueueUrl: process.env.NFE_RESULTS_QUEUE_URL!,
    nfeBucket:          process.env.NFE_BUCKET!,
  });
};

export default fp(configPlugin, { name: 'config' });
