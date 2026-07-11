# ── SQS queues for async NF-e emission ────────────────────────────────────────

resource "aws_sqs_queue" "nfe_dlq" {
  name                      = "erp-lite-nfe-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days — time to investigate and replay failures
  tags                      = { Environment = var.environment }
}

resource "aws_sqs_queue" "nfe_requests" {
  name                       = "erp-lite-nfe-requests-${var.environment}"
  visibility_timeout_seconds = 300 # must be >= Lambda timeout (270s)
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.nfe_dlq.arn
    maxReceiveCount     = 3 # 3 failures → DLQ → alarm fires
  })

  tags = { Environment = var.environment }
}

resource "aws_sqs_queue" "nfe_results" {
  name                       = "erp-lite-nfe-results-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 15 # long-poll: reduces SQS API calls and result latency
  tags                       = { Environment = var.environment }
}

# ── CloudWatch alarm: any message in DLQ = NF-e failed 3× ────────────────────
resource "aws_cloudwatch_metric_alarm" "nfe_dlq_depth" {
  alarm_name          = "erp-lite-nfe-dlq-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "NF-e failed 3× and landed in DLQ — manual intervention required"
  treat_missing_data  = "notBreaching"

  dimensions = { QueueName = aws_sqs_queue.nfe_dlq.name }

  tags = { Environment = var.environment }
}

# ── SQS queues for async notifications ────────────────────────────────────────

resource "aws_sqs_queue" "notifications_dlq" {
  name                      = "erp-lite-notifications-dlq-${var.environment}"
  message_retention_seconds = 1209600  # 14 days
  tags                      = { Environment = var.environment }
}

resource "aws_sqs_queue" "notifications" {
  name                       = "erp-lite-notifications-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.notifications_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Environment = var.environment }
}

# ── SQS queues for async boleto billing ───────────────────────────────────────

resource "aws_sqs_queue" "billing_dlq" {
  name                      = "erp-lite-billing-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
  tags                      = { Environment = var.environment }
}

resource "aws_sqs_queue" "billing_requests" {
  name                       = "erp-lite-billing-requests-${var.environment}"
  visibility_timeout_seconds = 120 # >= Lambda timeout (90s)
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.billing_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Environment = var.environment }
}

resource "aws_sqs_queue" "billing_results" {
  name                       = "erp-lite-billing-results-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 15
  tags                       = { Environment = var.environment }
}

resource "aws_cloudwatch_metric_alarm" "billing_dlq_depth" {
  alarm_name          = "erp-lite-billing-dlq-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Billing boleto failed 3× and landed in DLQ — manual intervention required"
  treat_missing_data  = "notBreaching"

  dimensions = { QueueName = aws_sqs_queue.billing_dlq.name }

  tags = { Environment = var.environment }
}

# ── SQS queues for Mercado Livre marketplace sync (Fase 2) ────────────────────
# marketplace_sync_requests: api-core (ECS) publica sync_material/fetch_resource
# → lambda-marketplace consome → publica em marketplace_sync_results
# → marketplaceSyncResultsWorker (api-core) consome e persiste no Postgres.

resource "aws_sqs_queue" "marketplace_sync_dlq" {
  name                      = "erp-lite-marketplace-sync-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
  tags                      = { Environment = var.environment }
}

resource "aws_sqs_queue" "marketplace_sync_requests" {
  name                       = "erp-lite-marketplace-sync-requests-${var.environment}"
  visibility_timeout_seconds = 60 # >= Lambda timeout (30s)
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.marketplace_sync_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Environment = var.environment }
}

resource "aws_sqs_queue" "marketplace_sync_results" {
  name                       = "erp-lite-marketplace-sync-results-${var.environment}"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 15 # long-poll
  tags                       = { Environment = var.environment }
}

resource "aws_cloudwatch_metric_alarm" "marketplace_sync_dlq_depth" {
  alarm_name          = "erp-lite-marketplace-sync-dlq-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Marketplace sync (Mercado Livre) failed 3× and landed in DLQ — manual intervention required"
  treat_missing_data  = "notBreaching"

  dimensions = { QueueName = aws_sqs_queue.marketplace_sync_dlq.name }

  tags = { Environment = var.environment }
}

# ── SQS queues for WhatsApp — Cobranças e Notificações ────────────────────────
# whatsapp_requests: api-core (ECS) publica o envio de template → lambda-whatsapp
# consome → publica o resultado em whatsapp_results → whatsappResultsWorker
# (api-core) consome e persiste no Postgres. Status de entrega/leitura chegam
# depois por webhook (POST /v1/public/whatsapp/webhook), não por esta fila.

resource "aws_sqs_queue" "whatsapp_dlq" {
  name                      = "erp-lite-whatsapp-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
  tags                      = { Environment = var.environment }
}

resource "aws_sqs_queue" "whatsapp_requests" {
  name                       = "erp-lite-whatsapp-requests-${var.environment}"
  visibility_timeout_seconds = 30 # >= Lambda timeout (15s)
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.whatsapp_dlq.arn
    maxReceiveCount      = 3
  })

  tags = { Environment = var.environment }
}

resource "aws_sqs_queue" "whatsapp_results" {
  name                       = "erp-lite-whatsapp-results-${var.environment}"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 15 # long-poll
  tags                       = { Environment = var.environment }
}

resource "aws_cloudwatch_metric_alarm" "whatsapp_dlq_depth" {
  alarm_name          = "erp-lite-whatsapp-dlq-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "WhatsApp message failed 3× and landed in DLQ — manual intervention required"
  treat_missing_data  = "notBreaching"

  dimensions = { QueueName = aws_sqs_queue.whatsapp_dlq.name }

  tags = { Environment = var.environment }
}

# ── IAM: ECS task role permissions for SQS ────────────────────────────────────
resource "aws_iam_role_policy" "ecs_task_sqs" {
  name = "nfe-notifications-billing-sqs"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.nfe_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.nfe_results.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.notifications.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.billing_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.billing_results.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.marketplace_sync_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.marketplace_sync_results.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.whatsapp_requests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.whatsapp_results.arn
      }
    ]
  })
}
