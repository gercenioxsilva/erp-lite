# ── S3 bucket for Service Visit photos + client signature ───────────────────
# Módulo opcional (tenant_modules.module_key = 'service_orders'). Contém dado
# pessoal sensível (CPF do técnico fica só no banco, mas a assinatura do
# cliente e as fotos de campo ficam aqui) — por isso este bucket recebe um
# tratamento mais rígido que nfe_xmls/billing_pdfs:
#   - SSE-KMS com chave dedicada (não AES256 gerenciado pela AWS), para ter
#     trilha de uso da chave via CloudTrail — custo extra é pequeno
#     (~US$1/mês de chave + centavos por 10k requisições) e proporcional ao
#     tipo de dado.
#   - Nunca ACL pública — upload/leitura só via URL assinada de curta duração,
#     geradas pela api-core (ver servicePhotoStorageService.ts).
#   - CORS habilitado só para permitir o presigned POST vindo direto do
#     navegador do técnico (upload nunca passa pelo Fargate — controle de
#     custo: ECS não paga CPU/tempo proxiando binário de foto).
#   - Sem expiração automática nesta v1 — prazo de retenção é decisão de
#     negócio (garantia do serviço prestado) ainda não definida; só a
#     transição para classe mais barata está configurada. Definir e aplicar
#     expiração é um follow-up documentado no README.

resource "aws_kms_key" "service_visit_photos" {
  description             = "SSE-KMS para fotos/assinatura de visita técnica (dado pessoal sensível)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Environment = var.environment }
}

resource "aws_kms_alias" "service_visit_photos" {
  name          = "alias/erp-lite-service-visit-photos-${var.environment}"
  target_key_id = aws_kms_key.service_visit_photos.key_id
}

resource "aws_s3_bucket" "service_visit_photos" {
  bucket        = "erp-lite-service-visit-photos-${var.environment}-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "prod"
  tags          = { Environment = var.environment }
}

resource "aws_s3_bucket_public_access_block" "service_visit_photos" {
  bucket                  = aws_s3_bucket.service_visit_photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "service_visit_photos" {
  bucket = aws_s3_bucket.service_visit_photos.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.service_visit_photos.arn
    }
    bucket_key_enabled = true # reduz custo de chamadas ao KMS
  }
}

# Sem necessidade de histórico de versões aqui (diferente de nfe_xmls, que é
# documento fiscal imutável) — a assinatura tem chave fixa por visita e pode
# ser sobrescrita de propósito em caso de reenvio.
resource "aws_s3_bucket_versioning" "service_visit_photos" {
  bucket = aws_s3_bucket.service_visit_photos.id
  versioning_configuration { status = "Suspended" }
}

resource "aws_s3_bucket_lifecycle_configuration" "service_visit_photos" {
  bucket = aws_s3_bucket.service_visit_photos.id
  rule {
    id     = "cold-storage-after-90-days"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
  }
}

# CORS — obrigatório para o presigned POST funcionar (upload direto do
# navegador do técnico, sem passar pela api-core).
resource "aws_s3_bucket_cors_configuration" "service_visit_photos" {
  bucket = aws_s3_bucket.service_visit_photos.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = var.app_public_origins
    allowed_headers = ["*"]
    max_age_seconds = 300
  }
}

# Nega qualquer requisição fora de HTTPS — cinto e suspensório além do padrão
# do SDK (que já usa TLS), fecha a porta para qualquer chamada http:// direta.
resource "aws_s3_bucket_policy" "service_visit_photos_deny_insecure" {
  bucket = aws_s3_bucket.service_visit_photos.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.service_visit_photos.arn,
        "${aws_s3_bucket.service_visit_photos.arn}/*",
      ]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# IAM — api-core só pode Put/Get objetos (nunca ListBucket: a aplicação
# sempre sabe a key exata que precisa, não precisa enumerar o bucket).
resource "aws_iam_role_policy" "ecs_task_service_visit_photos" {
  name = "erp-lite-service-visit-photos-${var.environment}"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.service_visit_photos.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.service_visit_photos.arn
      },
    ]
  })
}
