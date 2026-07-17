import type { SQSHandler } from 'aws-lambda';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { processRecord, processNfseRecord, processRemessaRecord } from './services/nfeService';
import { processCompanyRegistrationRecord } from './services/companyRegistrationService';

// Singleton: reuses Fastify app (AWS clients + FocusNfe cache) across warm invocations.
// buildApp() already calls app.ready() so the app is fully initialized on first call.
let _app: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!_app) _app = await buildApp();
  return _app;
}

export const handler: SQSHandler = async (event) => {
  const app = await getApp();
  const failures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      if (body.type === 'nfse') {
        await processNfseRecord(app, record);
      } else if (body.type === 'remessa') {
        await processRemessaRecord(app, record);
      } else if (body.type === 'company_registration') {
        await processCompanyRegistrationRecord(app, record);
      } else {
        await processRecord(app, record);
      }
    } catch (err) {
      app.log.error({ event: 'record_failed', messageId: record.messageId, error: String(err) });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  if (failures.length) return { batchItemFailures: failures };
};
