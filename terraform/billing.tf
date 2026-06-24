# ── IAM role for lambda-billing ───────────────────────────────────────────────

resource "aws_iam_role" "lambda_billing" {
  name = "erp-lite-lambda-billing-${var.environment}"

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy_attachment" "lambda_billing_basic" {
  role       = aws_iam_role.lambda_billing.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_billing_sqs_s3" {
  name = "billing-sqs-s3"
  role = aws_iam_role.lambda_billing.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.billing_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.billing_results.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.billing_pdfs.arn}/*"
      }
    ]
  })
}

# ── Lambda function — container image ─────────────────────────────────────────

resource "aws_lambda_function" "billing" {
  function_name = "erp-lite-billing-${var.environment}"
  role          = aws_iam_role.lambda_billing.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda_billing.repository_url}:${var.lambda_billing_image_tag}"
  timeout       = 90    # Itaú API can be slow; well under SQS VT of 120s
  memory_size   = 256

  # Limit concurrent executions to avoid overwhelming the bank API
  reserved_concurrent_executions = 10

  environment {
    variables = {
      # AWS_REGION is reserved by Lambda runtime — injected automatically, never set here.
      BILLING_RESULTS_QUEUE_URL = aws_sqs_queue.billing_results.url
      BILLING_BUCKET            = aws_s3_bucket.billing_pdfs.bucket
      ITAU_CLIENT_ID            = var.itau_client_id
      ITAU_CLIENT_SECRET        = var.itau_client_secret
      ITAU_BASE_URL             = "https://api.itau.com.br"
      ITAU_AUTH_URL             = "https://sts.itau.com.br/itauBank/api/v2/token"
      LOG_LEVEL                 = "info"
    }
  }

  tags = { Environment = var.environment }
}

# ── SQS event source mapping (billing-requests → Lambda trigger) ───────────────

resource "aws_lambda_event_source_mapping" "billing_sqs" {
  event_source_arn                   = aws_sqs_queue.billing_requests.arn
  function_name                      = aws_lambda_function.billing.arn
  batch_size                         = 1   # one boleto per invocation for predictable error handling
  function_response_types            = ["ReportBatchItemFailures"]
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_billing" {
  name              = "/aws/lambda/${aws_lambda_function.billing.function_name}"
  retention_in_days = 14
  tags              = { Environment = var.environment }
}
