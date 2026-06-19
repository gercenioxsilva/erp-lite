import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { SESv2Client } from '@aws-sdk/client-sesv2';

declare module 'fastify' {
  interface FastifyInstance {
    ses: SESv2Client;
  }
}

const sesPlugin: FastifyPluginAsync = async (app) => {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  app.decorate('ses', new SESv2Client({
    region: app.config.awsRegion,
    ...(endpoint && { endpoint }),
  }));
};

export default fp(sesPlugin, { name: 'ses', dependencies: ['config'] });
