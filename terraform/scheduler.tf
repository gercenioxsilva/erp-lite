# ── EventBridge Scheduler: RDS auto-stop/start (non-prod only) ────────────────
# Stops the RDS instance Mon–Fri at 20h Brasília and restarts at 08h Brasília.
# Active hours: ~12h/weekday × 5 days = 260 h/month instead of 720 h/month.
# Saves ~60% of dev RDS cost (~$7.50/month for db.t3.micro).
#
# Not deployed for prod (environment == "prod") — prod DB must stay always-on.
# Weekends: DB stays stopped from Friday 20h until Monday 08h (< 7-day AWS limit).
# If someone needs weekend access: start manually via AWS Console or CLI.
#   aws rds start-db-instance --db-instance-identifier erp-lite-postgres-dev

locals {
  enable_rds_schedule = var.environment != "prod"
}

resource "aws_iam_role" "rds_scheduler" {
  count = local.enable_rds_schedule ? 1 : 0
  name  = "erp-lite-rds-scheduler-${var.environment}"

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

resource "aws_iam_role_policy" "rds_scheduler" {
  count = local.enable_rds_schedule ? 1 : 0
  name  = "rds-start-stop"
  role  = aws_iam_role.rds_scheduler[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["rds:StopDBInstance", "rds:StartDBInstance"]
      Resource = aws_db_instance.postgres.arn
    }]
  })
}

resource "aws_scheduler_schedule" "rds_stop" {
  count                        = local.enable_rds_schedule ? 1 : 0
  name                         = "erp-lite-rds-stop-${var.environment}"
  schedule_expression          = "cron(0 20 ? * MON-FRI *)"
  schedule_expression_timezone = "America/Sao_Paulo"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBInstance"
    role_arn = aws_iam_role.rds_scheduler[0].arn
    input    = jsonencode({ DbInstanceIdentifier = aws_db_instance.postgres.identifier })
  }
}

resource "aws_scheduler_schedule" "rds_start" {
  count                        = local.enable_rds_schedule ? 1 : 0
  name                         = "erp-lite-rds-start-${var.environment}"
  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "America/Sao_Paulo"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:startDBInstance"
    role_arn = aws_iam_role.rds_scheduler[0].arn
    input    = jsonencode({ DbInstanceIdentifier = aws_db_instance.postgres.identifier })
  }
}
