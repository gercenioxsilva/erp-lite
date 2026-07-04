# ── IAM role for lambda-marketplace ───────────────────────────────────────────

resource "aws_iam_role" "lambda_marketplace" {
  name = "erp-lite-lambda-marketplace-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy_attachment" "lambda_marketplace_basic" {
  role       = aws_iam_role.lambda_marketplace.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_marketplace_sqs" {
  name = "marketplace-sqs"
  role = aws_iam_role.lambda_marketplace.id

  # Sem S3 aqui — diferente de lambda-billing, este Lambda só fala com a API
  # do Mercado Livre (JSON) e devolve o resultado via SQS, nunca gera arquivo.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.marketplace_sync_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.marketplace_sync_results.arn
      }
    ]
  })
}

# ── Lambda function — container image ─────────────────────────────────────────

resource "aws_lambda_function" "marketplace" {
  function_name = "erp-lite-marketplace-${var.environment}"
  role          = aws_iam_role.lambda_marketplace.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda_marketplace.repository_url}:${var.lambda_marketplace_image_tag}"
  timeout       = 30 # API do ML é só JSON, sem geração de PDF — bem mais rápido que billing
  memory_size   = 256

  # Mais enxuto que billing (10): API do Mercado Livre tem rate limit mais restrito
  reserved_concurrent_executions = 5

  environment {
    variables = {
      # AWS_REGION é reservado pelo runtime do Lambda — nunca definir aqui.
      MARKETPLACE_SYNC_RESULTS_QUEUE_URL = aws_sqs_queue.marketplace_sync_results.url
      MERCADO_LIVRE_CLIENT_ID            = var.mercado_livre_client_id
      MERCADO_LIVRE_CLIENT_SECRET        = var.mercado_livre_client_secret
      MERCADO_LIVRE_API_BASE_URL         = "https://api.mercadolibre.com"
      MERCADO_LIVRE_TOKEN_URL            = "https://api.mercadolibre.com/oauth/token"
      LOG_LEVEL                          = "info"
    }
  }

  tags = { Environment = var.environment }
}

# ── SQS event source mapping (marketplace-sync-requests → Lambda trigger) ────

resource "aws_lambda_event_source_mapping" "marketplace_sqs" {
  event_source_arn        = aws_sqs_queue.marketplace_sync_requests.arn
  function_name           = aws_lambda_function.marketplace.arn
  batch_size              = 1 # uma sincronização/webhook por invocação, mesmo racional de billing
  function_response_types = ["ReportBatchItemFailures"]
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_marketplace" {
  name              = "/aws/lambda/${aws_lambda_function.marketplace.function_name}"
  retention_in_days = 14
  tags              = { Environment = var.environment }
}
