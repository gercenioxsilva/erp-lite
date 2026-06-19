# ── S3 bucket for SEFAZ-signed NF-e XMLs ─────────────────────────────────────
# Legal requirement (SEFAZ): NF-e XMLs must be retained for 60 months (5 years).
# Lifecycle transitions to cheaper tiers to minimize long-term storage cost.

resource "aws_s3_bucket" "nfe_xmls" {
  bucket        = "erp-lite-nfe-${var.environment}-${data.aws_caller_identity.current.account_id}"
  force_destroy = var.environment != "prod"
  tags          = { Environment = var.environment }
}

resource "aws_s3_bucket_public_access_block" "nfe_xmls" {
  bucket                  = aws_s3_bucket.nfe_xmls.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "nfe_xmls" {
  bucket = aws_s3_bucket.nfe_xmls.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "nfe_xmls" {
  bucket = aws_s3_bucket.nfe_xmls.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "nfe_xmls" {
  bucket = aws_s3_bucket.nfe_xmls.id

  rule {
    id     = "nfe-legal-retention"
    status = "Enabled"
    filter {}

    # After 1 year: move to Standard-IA ($0.0125/GB vs $0.023/GB)
    transition {
      days          = 365
      storage_class = "STANDARD_IA"
    }

    # After 5 years: move to Glacier Deep Archive ($0.00099/GB) — satisfies SEFAZ
    transition {
      days          = 1825
      storage_class = "GLACIER_DEEP_ARCHIVE"
    }
  }
}
