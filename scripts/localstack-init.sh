#!/bin/bash
# LocalStack initialization script — runs once after LocalStack is ready.
# Creates all queues, S3 bucket, and SES identity needed for local development.
set -e

EP="http://localhost:4566"
REGION="us-east-1"
ACCOUNT="000000000000"

echo "[localstack-init] Creating SQS queues..."

aws --endpoint-url="$EP" --region="$REGION" sqs create-queue \
  --queue-name nfe-dlq \
  --attributes MessageRetentionPeriod=1209600 \
  --output text --query 'QueueUrl'

aws --endpoint-url="$EP" --region="$REGION" sqs create-queue \
  --queue-name nfe-requests \
  --attributes VisibilityTimeout=300,MessageRetentionPeriod=86400 \
  --output text --query 'QueueUrl'

aws --endpoint-url="$EP" --region="$REGION" sqs create-queue \
  --queue-name nfe-results \
  --attributes VisibilityTimeout=60,ReceiveMessageWaitTimeSeconds=5 \
  --output text --query 'QueueUrl'

aws --endpoint-url="$EP" --region="$REGION" sqs create-queue \
  --queue-name notifications-dlq \
  --attributes MessageRetentionPeriod=1209600 \
  --output text --query 'QueueUrl'

aws --endpoint-url="$EP" --region="$REGION" sqs create-queue \
  --queue-name notifications \
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=86400 \
  --output text --query 'QueueUrl'

echo "[localstack-init] Creating S3 bucket..."
aws --endpoint-url="$EP" --region="$REGION" s3api create-bucket \
  --bucket nfe-xmls-local 2>/dev/null || echo "(bucket already exists)"

echo "[localstack-init] Verifying SES email identity..."
aws --endpoint-url="$EP" --region="$REGION" ses verify-email-identity \
  --email-address noreply@localhost 2>/dev/null || echo "(SES identity already registered)"

echo "[localstack-init] Done. Queue base URL: http://localstack:4566/${ACCOUNT}/"
