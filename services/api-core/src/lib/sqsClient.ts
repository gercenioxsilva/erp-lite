import { SQSClient } from '@aws-sdk/client-sqs';

let _client: SQSClient | null = null;

export function getSqsClient(): SQSClient {
  if (!_client) {
    const endpoint = process.env.AWS_ENDPOINT_URL;
    _client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(endpoint && { endpoint }),
    });
  }
  return _client;
}
