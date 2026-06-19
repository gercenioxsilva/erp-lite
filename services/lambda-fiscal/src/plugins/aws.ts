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
  const region = app.config.awsRegion;
  app.decorate('sqs', new SQSClient({ region }));
  app.decorate('s3',  new S3Client({ region }));
};

export default fp(awsPlugin, { name: 'aws', dependencies: ['config'] });
