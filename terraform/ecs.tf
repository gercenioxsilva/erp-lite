# ── IAM Roles ─────────────────────────────────────────────────────────────────
resource "aws_iam_role" "ecs_task_execution" {
  name = "erp-lite-ecs-execution-${var.environment}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "erp-lite-ecs-task-${var.environment}"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────
resource "aws_ecs_cluster" "main" {
  name = "erp-lite-${var.environment}"

  setting {
    name  = "containerInsights"
    value = var.environment == "prod" ? "enabled" : "disabled"
  }

  tags = { Environment = var.environment }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 0
  }
}

# ── Task Definition — api-core ─────────────────────────────────────────────────
resource "aws_ecs_task_definition" "api_core" {
  family                   = "erp-lite-api-core-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "api-core"
    image = "${aws_ecr_repository.api_core.repository_url}:${var.image_tag}"

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3000" },
      { name = "DATABASE_URL",
      value = "postgres://erp_lite:${urlencode(random_password.db_master.result)}@${aws_db_instance.postgres.endpoint}/erp_lite" },
      # pg v8.x may not apply Pool-level ssl when parsing a plain postgres:// URL.
      # PGSSLMODE=require guarantees SSL on every connection — belt-and-suspenders.
      { name = "PGSSLMODE", value = "require" },
      { name = "JWT_SECRET", value = var.jwt_secret },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "NFE_REQUESTS_QUEUE_URL",      value = aws_sqs_queue.nfe_requests.url },
      { name = "NFE_RESULTS_QUEUE_URL",      value = aws_sqs_queue.nfe_results.url },
      { name = "NFE_BUCKET",                 value = aws_s3_bucket.nfe_xmls.bucket },
      { name = "NOTIFICATIONS_QUEUE_URL",    value = aws_sqs_queue.notifications.url },
      { name = "BILLING_REQUESTS_QUEUE_URL", value = aws_sqs_queue.billing_requests.url },
      { name = "BILLING_RESULTS_QUEUE_URL",  value = aws_sqs_queue.billing_results.url },
      { name = "SERVICE_VISIT_PHOTOS_BUCKET", value = aws_s3_bucket.service_visit_photos.bucket },
      { name = "MARKETPLACE_SYNC_REQUESTS_QUEUE_URL", value = aws_sqs_queue.marketplace_sync_requests.url },
      { name = "MARKETPLACE_SYNC_RESULTS_QUEUE_URL", value = aws_sqs_queue.marketplace_sync_results.url },
      # Nomes sem "_" entre MERCADO e LIVRE — é o que marketplaceConnectionService.ts (Fase 1)
      # já lê hoje; diferente de MERCADO_LIVRE_CLIENT_ID/SECRET usado só pelo lambda-marketplace.
      { name = "MERCADOLIVRE_CLIENT_ID", value = var.mercado_livre_client_id },
      { name = "MERCADOLIVRE_CLIENT_SECRET", value = var.mercado_livre_client_secret },
      { name = "STRIPE_SECRET_KEY", value = var.stripe_secret_key },
      { name = "STRIPE_WEBHOOK_SECRET", value = var.stripe_webhook_secret },
      # Sem segredo de plataforma aqui — credenciais WhatsApp (Twilio) são por
      # tenant, lidas de whatsapp_accounts.credentials (regra 59, mesmo
      # racional do C6 Bank).
      { name = "WHATSAPP_REQUESTS_QUEUE_URL", value = aws_sqs_queue.whatsapp_requests.url },
      { name = "WHATSAPP_RESULTS_QUEUE_URL", value = aws_sqs_queue.whatsapp_results.url },
      # Mesmo token mestre já usado pelo lambda-fiscal (var.focus_nfe_token) —
      # api-core precisa dele em processo pras chamadas SÍNCRONAS de gestão de
      # empresa (upload de certificado, teste de conexão); o registro da
      # empresa em si é ASSÍNCRONO via nfe_requests/nfe_results (regra 70).
      { name = "FOCUS_NFE_TOKEN", value = var.focus_nfe_token },

      # ── Integrações (0087) ─────────────────────────────────────────────────
      # Credencial de integração é POR TENANT (tabela integration_providers,
      # editável na tela Integrações). O que segue é o FALLBACK DE PLATAFORMA,
      # usado só por tenant que ainda não configurou a própria conta.
      # Todas podem chegar vazias: ausente ⇒ a rota devolve 503 com corpo
      # padronizado e a UI mostra "aguardando configuração", nunca um erro.
      { name = "APP_URL", value = var.app_url },
      { name = "MARKETPLACE_STATE_SECRET", value = var.marketplace_state_secret },

      # Assistente fiscal + similaridade semântica na conciliação. NÃO é por
      # tenant — o custo é da plataforma; o teto diário é que é por tenant.
      { name = "ANTHROPIC_API_KEY", value = var.anthropic_api_key },
      { name = "ANTHROPIC_MODEL", value = var.anthropic_model },
      { name = "ASSISTANT_DAILY_CAP", value = var.assistant_daily_cap },

      # Open Finance (Pluggy)
      { name = "PLUGGY_CLIENT_ID", value = var.pluggy_client_id },
      { name = "PLUGGY_CLIENT_SECRET", value = var.pluggy_client_secret },

      # PGDAS-D / DAS (SERPRO Integra Contador) — all-or-nothing.
      { name = "SERPRO_CONSUMER_KEY", value = var.serpro_consumer_key },
      { name = "SERPRO_CONSUMER_SECRET", value = var.serpro_consumer_secret },
      { name = "SERPRO_MTLS_PFX_BASE64", value = var.serpro_mtls_pfx_base64 },
      { name = "SERPRO_MTLS_PFX_PASSWORD", value = var.serpro_mtls_pfx_password },
      { name = "SERPRO_ENV", value = var.serpro_env },

      # Google Calendar (módulo Agendamento)
      { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
      { name = "GOOGLE_CLIENT_SECRET", value = var.google_client_secret },
      { name = "GOOGLE_REDIRECT_URI", value = var.google_redirect_uri },

      # Buckets fiscais (s3-fiscal.tf) — faltavam: a aplicação já lia estas
      # envs, mas nada as injetava, então o original importado nunca era
      # arquivado em produção (sem erro visível, porque o código tolera).
      { name = "FISCAL_IMPORTS_BUCKET", value = aws_s3_bucket.fiscal_imports.bucket },
      { name = "FISCAL_DOCS_BUCKET", value = aws_s3_bucket.fiscal_docs.bucket },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api_core.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api-core"
        "awslogs-create-group"  = "true"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = { Environment = var.environment }
}

# ── NLB — replaces ALB ────────────────────────────────────────────────────────
# NLB base cost is identical to ALB ($0.008/hour) but capacity-unit pricing is
# ~8× cheaper (NLCU vs LCU), saving ~$8-10/month for low-traffic MVPs.
# NLB operates at Layer 4 (TCP) — sufficient for this API; no L7 features needed.
resource "aws_lb" "main" {
  name               = "erp-lite-nlb-${var.environment}"
  internal           = false
  load_balancer_type = "network"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Environment = var.environment }
}

resource "aws_lb_target_group" "api_core" {
  name                 = "erp-lite-api-core-${var.environment}"
  port                 = 3000
  protocol             = "TCP"
  vpc_id               = aws_vpc.main.id
  target_type          = "ip"
  deregistration_delay = 30 # faster rolling deploys (NLB default is 300s)

  health_check {
    protocol            = "HTTP"
    path                = "/health"
    healthy_threshold   = 3
    unhealthy_threshold = 3 # NLB requires healthy == unhealthy for HTTP health checks
    interval            = 30
    # timeout omitted: NLB ignores explicit timeout for HTTP health checks
  }

  tags = { Environment = var.environment }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api_core.arn
  }
}

# ── ECS Service — Fargate Spot ────────────────────────────────────────────────
# capacity_provider_strategy replaces launch_type = "FARGATE".
# FARGATE_SPOT is ~70% cheaper. FARGATE acts as automatic fallback when Spot
# capacity is unavailable in the AZ (ECS handles the failover transparently).
resource "aws_ecs_service" "api_core" {
  name            = "erp-lite-api-core-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api_core.arn
  desired_count   = var.api_desired_count

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 4 # prefer Spot (80%)
    base              = 0
  }
  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1 # automatic fallback when Spot unavailable (20%)
    base              = 0
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id # public subnets — no NAT Gateway needed
    security_groups  = [aws_security_group.api_core.id]
    assign_public_ip = true # required for ECR image pulls without NAT
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api_core.arn
    container_name   = "api-core"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = var.environment == "prod" ? 50 : 0
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]

  tags = { Environment = var.environment }
}
