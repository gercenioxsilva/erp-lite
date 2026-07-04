import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface AppConfig {
  awsRegion: string;
  marketplaceSyncResultsQueueUrl: string;
  // Mercado Livre app credentials (platform-level; um único app cadastrado
  // pelo desenvolvedor, compartilhado por todas as conexões/empresas —
  // access_token/refresh_token por conexão vêm na própria mensagem SQS).
  mercadoLivreClientId: string;
  mercadoLivreClientSecret: string;
  mercadoLivreApiBaseUrl: string;
  mercadoLivreTokenUrl: string;
}

declare module 'fastify' {
  interface FastifyInstance { config: AppConfig; }
}

const configPlugin: FastifyPluginAsync = async (app) => {
  const required = ['MARKETPLACE_SYNC_RESULTS_QUEUE_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  app.decorate('config', {
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    marketplaceSyncResultsQueueUrl: process.env.MARKETPLACE_SYNC_RESULTS_QUEUE_URL!,
    // Opcionais — se ausentes, o adapter lança um erro claro em vez de derrubar o Lambda
    mercadoLivreClientId:     process.env.MERCADO_LIVRE_CLIENT_ID     ?? '',
    mercadoLivreClientSecret: process.env.MERCADO_LIVRE_CLIENT_SECRET ?? '',
    mercadoLivreApiBaseUrl:   process.env.MERCADO_LIVRE_API_BASE_URL  ?? 'https://api.mercadolibre.com',
    mercadoLivreTokenUrl:     process.env.MERCADO_LIVRE_TOKEN_URL     ?? 'https://api.mercadolibre.com/oauth/token',
  });
};

export default fp(configPlugin, { name: 'config' });
