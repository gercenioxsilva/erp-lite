import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { SQSClient } from '@aws-sdk/client-sqs';

declare module 'fastify' {
  interface FastifyInstance {
    sqs: SQSClient;
  }
}

const awsPlugin: FastifyPluginAsync = async (app) => {
  const region   = app.config.awsRegion;
  const endpoint = process.env.AWS_ENDPOINT_URL;
  app.decorate('sqs', new SQSClient({ region, ...(endpoint && { endpoint }) }));
};

export default fp(awsPlugin, { name: 'aws', dependencies: ['config'] });
