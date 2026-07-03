import { S3Client } from '@aws-sdk/client-s3';

let _client: S3Client | null = null;

// Mesmo padrão de sqsClient.ts — cliente singleton, AWS_ENDPOINT_URL permite
// apontar para LocalStack em desenvolvimento local.
export function getS3Client(): S3Client {
  if (!_client) {
    const endpoint = process.env.AWS_ENDPOINT_URL;
    _client = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(endpoint && { endpoint, forcePathStyle: true }),
    });
  }
  return _client;
}
