// Local development runner: polls SQS whatsapp-requests and calls the handler
// (mesmo padrão de lambda-billing/src/localRunner.ts).
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { buildApp } from './app';
import { processRecord } from './services/whatsappService';

const QUEUE_URL = process.env.WHATSAPP_REQUESTS_QUEUE_URL;

if (!QUEUE_URL) {
  console.error('WHATSAPP_REQUESTS_QUEUE_URL not set — whatsapp local runner cannot start');
  process.exit(1);
}

async function main() {
  const app = await buildApp();
  const endpoint = process.env.AWS_ENDPOINT_URL;
  const sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint && { endpoint }),
  });

  app.log.info({ event: 'local_runner_started', queue: QUEUE_URL });

  while (true) {
    try {
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl:            QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds:     5,
      }));

      for (const msg of resp.Messages ?? []) {
        try {
          await processRecord(app, msg as any);
          await sqs.send(new DeleteMessageCommand({
            QueueUrl:      QUEUE_URL!,
            ReceiptHandle: msg.ReceiptHandle!,
          }));
        } catch (err) {
          app.log.error({ event: 'local_runner_error', error: String(err) });
        }
      }
    } catch (err) {
      app.log.error({ event: 'local_poll_error', error: String(err) });
      await sleep(3_000);
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

main().catch(err => {
  console.error('Lambda whatsapp local runner fatal error:', err);
  process.exit(1);
});
