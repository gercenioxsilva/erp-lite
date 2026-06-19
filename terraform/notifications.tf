# ── IAM role for lambda-notifications ─────────────────────────────────────────

resource "aws_iam_role" "lambda_notifications" {
  name = "erp-lite-lambda-notifications-${var.environment}"

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

resource "aws_iam_role_policy_attachment" "lambda_notifications_basic" {
  role       = aws_iam_role.lambda_notifications.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_notifications_sqs_ses" {
  name = "sqs-ses"
  role = aws_iam_role.lambda_notifications.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.notifications.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "sesv2:SendEmail"]
        Resource = "*"
      }
    ]
  })
}

# ── Lambda function — container image ─────────────────────────────────────────

resource "aws_lambda_function" "notifications" {
  function_name = "erp-lite-notifications-${var.environment}"
  role          = aws_iam_role.lambda_notifications.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda_notifications.repository_url}:${var.lambda_notifications_image_tag}"
  timeout       = 60
  memory_size   = 256

  environment {
    variables = {
      AWS_REGION             = var.aws_region
      SES_FROM_EMAIL         = var.ses_from_email
      SES_FROM_NAME          = var.ses_from_name
      NOTIFICATIONS_QUEUE_URL = aws_sqs_queue.notifications.url
      LOG_LEVEL              = "info"
    }
  }

  tags = { Environment = var.environment }
}

# ── SQS event source mapping (SQS → Lambda trigger) ───────────────────────────

resource "aws_lambda_event_source_mapping" "notifications_sqs" {
  event_source_arn                   = aws_sqs_queue.notifications.arn
  function_name                      = aws_lambda_function.notifications.arn
  batch_size                         = 10
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_notifications" {
  name              = "/aws/lambda/${aws_lambda_function.notifications.function_name}"
  retention_in_days = 14
  tags              = { Environment = var.environment }
}
