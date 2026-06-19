import { SQSClient } from '@aws-sdk/client-sqs';

let _client: SQSClient | null = null;

export function getSqsClient(): SQSClient {
  if (!_client) {
    _client = new SQSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  }
  return _client;
}
