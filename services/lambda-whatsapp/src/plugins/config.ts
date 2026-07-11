import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

// Sem credencial de plataforma aqui — diferente do Itaú em lambda-billing
// (app OAuth compartilhado), o WhatsApp é 100% por tenant (regra 59, mesmo
// racional do C6 Bank): account_sid/auth_token vêm sempre da mensagem SQS
// (payload.account.credentials), nunca de env var. Isso também elimina de
// raiz o tipo de risco documentado na regra do checklist de env var
// (segredo de plataforma esquecido no Terraform) — não existe segredo de
// plataforma pra esquecer.
export interface AppConfig {
  awsRegion: string;
  whatsappResultsQueueUrl: string;
}

declare module 'fastify' {
  interface FastifyInstance { config: AppConfig; }
}

const configPlugin: FastifyPluginAsync = async (app) => {
  const required = ['WHATSAPP_RESULTS_QUEUE_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  app.decorate('config', {
    awsRegion:               process.env.AWS_REGION ?? 'us-east-1',
    whatsappResultsQueueUrl: process.env.WHATSAPP_RESULTS_QUEUE_URL!,
  });
};

export default fp(configPlugin, { name: 'config' });
