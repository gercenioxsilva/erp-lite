# ── S3 buckets do módulo Fiscal ───────────────────────────────────────────────
# Faltavam no Terraform: a api-core já lia FISCAL_IMPORTS_BUCKET e
# FISCAL_DOCS_BUCKET, mas nenhum bucket era provisionado nem injetado na task —
# em produção o upload silenciosamente não arquivava o original (o código trata
# ausência como "pula o S3", então não havia erro visível).
#
# Dois buckets separados de propósito: o de imports guarda o que o CLIENTE
# enviou (extrato OFX/CSV/XLSX) e o de docs guarda o que o GOVERNO devolveu
# (PDF do DAS). Retenções e riscos diferentes não devem dividir prefixo.

# ── Arquivos originais de importação (OFX/CSV/XLSX) ──────────────────────────
resource "aws_s3_bucket" "fiscal_imports" {
  bucket = "erp-lite-fiscal-imports-${var.environment}"
  tags   = { Environment = var.environment }
}

resource "aws_s3_bucket_versioning" "fiscal_imports" {
  bucket = aws_s3_bucket.fiscal_imports.id
  # Versionamento ligado: o original importado é a prova de origem de um
  # lançamento conciliado. Sobrescrita acidental não pode ser irreversível.
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "fiscal_imports" {
  bucket = aws_s3_bucket.fiscal_imports.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "fiscal_imports" {
  bucket                  = aws_s3_bucket.fiscal_imports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "fiscal_imports" {
  bucket = aws_s3_bucket.fiscal_imports.id
  rule {
    id     = "archive-imports"
    status = "Enabled"
    transition {
      days          = 180
      storage_class = "DEEP_ARCHIVE"
    }
    expiration { days = 2557 } # ~7 anos (obrigação fiscal)
  }
}

# ── Documentos fiscais gerados (PDF do DAS via SERPRO) ───────────────────────
resource "aws_s3_bucket" "fiscal_docs" {
  bucket = "erp-lite-fiscal-docs-${var.environment}"
  tags   = { Environment = var.environment }
}

resource "aws_s3_bucket_versioning" "fiscal_docs" {
  bucket = aws_s3_bucket.fiscal_docs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "fiscal_docs" {
  bucket = aws_s3_bucket.fiscal_docs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "fiscal_docs" {
  bucket                  = aws_s3_bucket.fiscal_docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "fiscal_docs" {
  bucket = aws_s3_bucket.fiscal_docs.id
  rule {
    id     = "archive-docs"
    status = "Enabled"
    # DAS é baixado por URL assinada logo após gerar; depois vira arquivo morto.
    transition {
      days          = 90
      storage_class = "DEEP_ARCHIVE"
    }
    expiration { days = 2557 } # ~7 anos (obrigação fiscal)
  }
}

# IAM — api-core só Put/Get objeto (nunca ListBucket: a aplicação sempre sabe a
# key exata). Mesmo racional de ecs_task_service_visit_photos.
resource "aws_iam_role_policy" "ecs_task_fiscal_buckets" {
  name = "erp-lite-fiscal-buckets-${var.environment}"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = [
          "${aws_s3_bucket.fiscal_imports.arn}/*",
          "${aws_s3_bucket.fiscal_docs.arn}/*",
        ]
      },
    ]
  })
}
