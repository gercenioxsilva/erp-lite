import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface AppConfig {
  awsRegion:             string;
  billingResultsQueueUrl: string;
  billingBucket:          string;
  // Itaú API credentials (platform-level; shared across tenants using Itaú)
  itauClientId:     string;
  itauClientSecret: string;
  itauBaseUrl:      string;
  itauAuthUrl:      string;
}

declare module 'fastify' {
  interface FastifyInstance { config: AppConfig; }
}

const configPlugin: FastifyPluginAsync = async (app) => {
  const required = ['BILLING_RESULTS_QUEUE_URL', 'BILLING_BUCKET'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  app.decorate('config', {
    awsRegion:              process.env.AWS_REGION                ?? 'us-east-1',
    billingResultsQueueUrl: process.env.BILLING_RESULTS_QUEUE_URL!,
    billingBucket:          process.env.BILLING_BUCKET!,
    // Itaú — optional; if absent, adapter returns a clear error without crashing Lambda
    itauClientId:     process.env.ITAU_CLIENT_ID     ?? '',
    itauClientSecret: process.env.ITAU_CLIENT_SECRET ?? '',
    itauBaseUrl:      process.env.ITAU_BASE_URL       ?? 'https://api.itau.com.br',
    itauAuthUrl:      process.env.ITAU_AUTH_URL       ?? 'https://sts.itau.com.br/itauBank/api/v2/token',
  });
};

export default fp(configPlugin, { name: 'config' });
