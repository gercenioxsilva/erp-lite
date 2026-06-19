import type { SQSHandler } from 'aws-lambda';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { processRecord } from './services/nfeService';

// Singleton: reuses Fastify app (and all decorated clients) across warm invocations
let _app: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!_app) {
    _app = await buildApp();
    await _app.ready();
  }
  return _app;
}

export const handler: SQSHandler = async (event) => {
  const app = await getApp();
  const failures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processRecord(app, record);
    } catch (err) {
      app.log.error({ event: 'record_failed', messageId: record.messageId, error: String(err) });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  if (failures.length) return { batchItemFailures: failures };
};
