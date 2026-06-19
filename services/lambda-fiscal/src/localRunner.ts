/**
 * Local development runner — simulates the SQS → Lambda trigger that AWS
 * manages in production. Polls NFE_REQUESTS_QUEUE_URL and calls the same
 * handler function, then deletes successfully processed messages.
 *
 * Used as the Docker Compose entrypoint for the lambda-fiscal service:
 *   CMD ["npx", "ts-node", "src/localRunner.ts"]
 */
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { handler } from './handler';

const queueUrl = process.env.NFE_REQUESTS_QUEUE_URL;
if (!queueUrl) {
  console.error(JSON.stringify({ event: 'runner_config_error', message: 'NFE_REQUESTS_QUEUE_URL is required' }));
  process.exit(1);
}

const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.AWS_ENDPOINT_URL && { endpoint: process.env.AWS_ENDPOINT_URL }),
});

function toSqsRecord(msg: Message): SQSRecord {
  return {
    messageId:         msg.MessageId!,
    receiptHandle:     msg.ReceiptHandle!,
    body:              msg.Body!,
    attributes:        {} as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody:         msg.MD5OfBody ?? '',
    eventSource:       'aws:sqs',
    eventSourceARN:    queueUrl!,
    awsRegion:         process.env.AWS_REGION ?? 'us-east-1',
  };
}

async function run(): Promise<void> {
  console.info(JSON.stringify({ event: 'local_runner_started', queueUrl }));

  while (true) {
    try {
      const resp = await sqs.send(new ReceiveMessageCommand({
        QueueUrl:            queueUrl!,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds:     5,
      }));

      const messages = resp.Messages ?? [];
      if (!messages.length) continue;

      const event: SQSEvent = { Records: messages.map(toSqsRecord) };
      const result = await handler(event, {} as any, () => {});
      const failedIds = new Set((result?.batchItemFailures ?? []).map((f) => f.itemIdentifier));

      for (const msg of messages) {
        if (failedIds.has(msg.MessageId!)) {
          console.warn(JSON.stringify({ event: 'message_failed', messageId: msg.MessageId }));
          continue;
        }
        await sqs.send(new DeleteMessageCommand({
          QueueUrl:      queueUrl!,
          ReceiptHandle: msg.ReceiptHandle!,
        }));
      }
    } catch (err) {
      console.error(JSON.stringify({ event: 'runner_poll_error', error: String(err) }));
      await new Promise(r => setTimeout(r, 5_000));
    }
  }
}

run();
