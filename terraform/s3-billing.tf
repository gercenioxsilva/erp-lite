# ── S3 bucket for boleto PDFs ─────────────────────────────────────────────────
# Stores boleto PDFs downloaded from the bank (optional; boleto_url from bank is primary).
# Lifecycle: PDFs transition to DEEP_ARCHIVE after 1 year (7-year retention for fiscal records).

resource "aws_s3_bucket" "billing_pdfs" {
  bucket = "erp-lite-billing-pdfs-${var.environment}"
  tags   = { Environment = var.environment }
}

resource "aws_s3_bucket_versioning" "billing_pdfs" {
  bucket = aws_s3_bucket.billing_pdfs.id
  versioning_configuration { status = "Suspended" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "billing_pdfs" {
  bucket = aws_s3_bucket.billing_pdfs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "billing_pdfs" {
  bucket                  = aws_s3_bucket.billing_pdfs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "billing_pdfs" {
  bucket = aws_s3_bucket.billing_pdfs.id
  rule {
    id     = "archive-pdfs"
    status = "Enabled"
    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
    expiration { days = 2557 } # ~7 years (fiscal obligation)
  }
}
