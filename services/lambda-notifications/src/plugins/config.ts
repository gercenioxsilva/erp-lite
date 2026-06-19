import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

export interface AppConfig {
  awsRegion:              string;
  sesFromEmail:           string;
  sesFromName:            string;
  notificationsQueueUrl:  string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

const configPlugin: FastifyPluginAsync = async (app) => {
  const required = ['SES_FROM_EMAIL', 'NOTIFICATIONS_QUEUE_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  app.decorate('config', {
    awsRegion:             process.env.AWS_REGION              ?? 'us-east-1',
    sesFromEmail:          process.env.SES_FROM_EMAIL!,
    sesFromName:           process.env.SES_FROM_NAME           ?? 'GAX ERP',
    notificationsQueueUrl: process.env.NOTIFICATIONS_QUEUE_URL!,
  });
};

export default fp(configPlugin, { name: 'config' });
