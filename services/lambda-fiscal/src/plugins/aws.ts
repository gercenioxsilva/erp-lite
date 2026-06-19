import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';

declare module 'fastify' {
  interface FastifyInstance {
    sqs: SQSClient;
    s3:  S3Client;
  }
}

const awsPlugin: FastifyPluginAsync = async (app) => {
  const region   = app.config.awsRegion;
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const base     = { region, ...(endpoint && { endpoint }) };
  // S3 LocalStack requires path-style addressing; no-op in production
  app.decorate('sqs', new SQSClient(base));
  app.decorate('s3',  new S3Client({ ...base, forcePathStyle: Boolean(endpoint) }));
};

export default fp(awsPlugin, { name: 'aws', dependencies: ['config'] });
