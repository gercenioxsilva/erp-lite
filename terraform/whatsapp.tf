# ── IAM role for lambda-whatsapp ──────────────────────────────────────────────

resource "aws_iam_role" "lambda_whatsapp" {
  name = "erp-lite-lambda-whatsapp-${var.environment}"

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

resource "aws_iam_role_policy_attachment" "lambda_whatsapp_basic" {
  role       = aws_iam_role.lambda_whatsapp.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_whatsapp_sqs" {
  name = "whatsapp-sqs"
  role = aws_iam_role.lambda_whatsapp.id

  # Sem S3 aqui — mesmo racional de lambda-marketplace: só fala com a API do
  # Twilio (JSON/form-urlencoded) e devolve o resultado via SQS, nunca gera
  # arquivo.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.whatsapp_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.whatsapp_results.arn
      }
    ]
  })
}

# ── Lambda function — container image ─────────────────────────────────────────
# Sem credencial de plataforma no environment — diferente do Mercado Livre
# (client_id/secret compartilhados), o Twilio é 100% por tenant (regra 59,
# mesmo racional do C6 Bank): account_sid/auth_token vêm sempre da própria
# mensagem SQS. Nada de segredo pra esquecer de wirear aqui.

resource "aws_lambda_function" "whatsapp" {
  function_name = "erp-lite-whatsapp-${var.environment}"
  role          = aws_iam_role.lambda_whatsapp.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda_whatsapp.repository_url}:${var.lambda_whatsapp_image_tag}"
  timeout       = 15  # 1 POST HTTP simples ao Twilio — mais rápido que billing/marketplace
  memory_size   = 256

  # Mesmo teto conservador de lambda-marketplace — controla custo/concorrência
  # sem necessidade real de mais capacidade nesta fase (MVP, volume baixo).
  reserved_concurrent_executions = 5

  environment {
    variables = {
      # AWS_REGION é reservado pelo runtime do Lambda — nunca definir aqui.
      WHATSAPP_RESULTS_QUEUE_URL = aws_sqs_queue.whatsapp_results.url
      LOG_LEVEL                  = "info"
    }
  }

  tags = { Environment = var.environment }
}

# ── SQS event source mapping (whatsapp-requests → Lambda trigger) ────────────

resource "aws_lambda_event_source_mapping" "whatsapp_sqs" {
  event_source_arn        = aws_sqs_queue.whatsapp_requests.arn
  function_name           = aws_lambda_function.whatsapp.arn
  batch_size              = 1 # uma mensagem por invocação, mesmo racional de billing/marketplace
  function_response_types = ["ReportBatchItemFailures"]
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_whatsapp" {
  name              = "/aws/lambda/${aws_lambda_function.whatsapp.function_name}"
  retention_in_days = 14
  tags              = { Environment = var.environment }
}
