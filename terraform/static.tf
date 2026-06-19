# ── S3 bucket — backoffice SPA ────────────────────────────────────────────────
# Bucket name uses account ID to guarantee global uniqueness without a random suffix.
locals {
  backoffice_bucket = "erp-lite-backoffice-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "backoffice" {
  bucket = local.backoffice_bucket
  tags   = { Environment = var.environment }
}

resource "aws_s3_bucket_public_access_block" "backoffice" {
  bucket                  = aws_s3_bucket.backoffice.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backoffice" {
  bucket = aws_s3_bucket.backoffice.id
  versioning_configuration { status = "Disabled" }
}

# ── CloudFront Origin Access Control (OAC) ────────────────────────────────────
# OAC is the modern replacement for OAI. CloudFront signs S3 requests with SigV4.
resource "aws_cloudfront_origin_access_control" "backoffice" {
  name                              = "erp-lite-backoffice-${var.environment}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront distribution ────────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "backoffice" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "ERP Lite backoffice — ${var.environment}"

  origin {
    domain_name              = aws_s3_bucket.backoffice.bucket_regional_domain_name
    origin_id                = "s3-backoffice"
    origin_access_control_id = aws_cloudfront_origin_access_control.backoffice.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-backoffice"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # SPA fallback: React Router owns all paths — return index.html on 403/404
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Environment = var.environment }
}

# ── S3 bucket policy — allow only CloudFront OAC ──────────────────────────────
resource "aws_s3_bucket_policy" "backoffice" {
  bucket = aws_s3_bucket.backoffice.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.backoffice.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.backoffice.arn
        }
      }
    }]
  })
}
