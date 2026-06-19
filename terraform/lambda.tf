# ── Lambda fiscal-nfe ─────────────────────────────────────────────────────────
# Runs WITHOUT VPC — calls Focus NF-e / SEFAZ directly via public internet.
# Reads SQS nfe-requests, writes S3 XMLs, publishes to SQS nfe-results.
# No NAT Gateway needed (Lambda's default network reaches internet natively).

resource "aws_iam_role" "lambda_fiscal" {
  name = "erp-lite-lambda-fiscal-${var.environment}"

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

resource "aws_iam_role_policy_attachment" "lambda_fiscal_basic" {
  role       = aws_iam_role.lambda_fiscal.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_fiscal" {
  name = "nfe-sqs-s3-xray"
  role = aws_iam_role.lambda_fiscal.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage", "sqs:DeleteMessage",
          "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"
        ]
        Resource = aws_sqs_queue.nfe_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.nfe_results.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.nfe_xmls.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "fiscal_nfe" {
  function_name = "erp-lite-fiscal-nfe-${var.environment}"
  role          = aws_iam_role.lambda_fiscal.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda_fiscal.repository_url}:${var.lambda_fiscal_image_tag}"

  # SEFAZ can take up to 3 min under peak load; Focus NF-e poll loop runs for 60s.
  # 270s = safe margin below the SQS visibility timeout of 300s.
  timeout     = 270
  memory_size = 512

  tracing_config { mode = "Active" }

  # Limit concurrency: prevents hammering SEFAZ and Focus NF-e during burst
  reserved_concurrent_executions = 5

  environment {
    variables = {
      FOCUS_NFE_TOKEN       = var.focus_nfe_token
      NFE_RESULTS_QUEUE_URL = aws_sqs_queue.nfe_results.url
      NFE_BUCKET            = aws_s3_bucket.nfe_xmls.bucket
    }
  }

  tags = { Environment = var.environment }

  depends_on = [aws_iam_role_policy_attachment.lambda_fiscal_basic]
}

# SQS triggers Lambda one message at a time (batch_size=1).
# report_batch_item_failures: only failed messages return to queue for retry.
resource "aws_lambda_event_source_mapping" "nfe_requests" {
  event_source_arn                   = aws_sqs_queue.nfe_requests.arn
  function_name                      = aws_lambda_function.fiscal_nfe.arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}

# ── CloudWatch alarm: Lambda error rate ───────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "lambda_fiscal_errors" {
  alarm_name          = "erp-lite-lambda-fiscal-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Lambda fiscal-nfe error rate elevated — check Focus NF-e / SEFAZ connectivity"
  treat_missing_data  = "notBreaching"

  dimensions = { FunctionName = aws_lambda_function.fiscal_nfe.function_name }

  tags = { Environment = var.environment }
}
