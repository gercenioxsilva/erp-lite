# ── EventBridge Scheduler: ciclo fiscal 23:59 (America/Sao_Paulo) ─────────────
# Dispara o ciclo agendado do módulo Fiscal (consolidar → validar → emitir
# NFS-e) publicando uma mensagem na fila NFE_RESULTS — que o api-core já
# consome (nfeResultsWorker) — com type='fiscal_consolidation_run'. Zero
# infra nova além deste schedule: sem Lambda extra, sem endpoint público.
# O worker roda o ciclo POR TENANT com o módulo 'fiscal' habilitado, com
# isolamento por-draft (erro em 1 nota nunca interrompe as outras).

resource "aws_iam_role" "fiscal_scheduler" {
  name = "erp-lite-fiscal-scheduler-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Environment = var.environment }
}

resource "aws_iam_role_policy" "fiscal_scheduler" {
  name = "fiscal-sqs-send"
  role = aws_iam_role.fiscal_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage"]
      Resource = aws_sqs_queue.nfe_results.arn
    }]
  })
}

resource "aws_scheduler_schedule" "fiscal_nightly_run" {
  name                         = "erp-lite-fiscal-nightly-${var.environment}"
  schedule_expression          = "cron(59 23 * * ? *)"
  schedule_expression_timezone = "America/Sao_Paulo"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:sqs:sendMessage"
    role_arn = aws_iam_role.fiscal_scheduler.arn
    input = jsonencode({
      QueueUrl    = aws_sqs_queue.nfe_results.url
      MessageBody = jsonencode({ type = "fiscal_consolidation_run" })
    })
  }
}
