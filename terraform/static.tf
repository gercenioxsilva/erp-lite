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

# Disables ACLs entirely — bucket owner owns all objects regardless of uploader.
# Required for OAC: when CI uploads files, bucket policy (not ACLs) controls access.
resource "aws_s3_bucket_ownership_controls" "backoffice" {
  bucket = aws_s3_bucket.backoffice.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
  depends_on = [aws_s3_bucket_public_access_block.backoffice]
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
  comment             = "ERP Lite backoffice - ${var.environment}"

  origin {
    domain_name              = aws_s3_bucket.backoffice.bucket_regional_domain_name
    origin_id                = "s3-backoffice"
    origin_access_control_id = aws_cloudfront_origin_access_control.backoffice.id
  }

  # NLB origin — receives /v1/* API requests forwarded from CloudFront over HTTP.
  # CloudFront terminates HTTPS on the viewer side; the internal hop to NLB uses HTTP
  # (origin_protocol_policy = "http-only"), which is safe within AWS and eliminates
  # the Mixed Content error that occurs when the SPA is served over HTTPS but calls
  # the load balancer endpoint directly over HTTP.
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Route /v1/* to the ALB — no caching, all HTTP methods forwarded.
  ordered_cache_behavior {
    path_pattern           = "/v1/*"
    target_origin_id       = "alb-api"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
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

  # SPA fallback: React Router owns all paths — return index.html on 403/404.
  # error_caching_min_ttl = 0 prevents CloudFront from caching the error response,
  # so fixes (policy changes, new deploys) take effect immediately.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
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
# depends_on guarantees public_access_block and ownership_controls are applied
# first, avoiding a race condition where the policy gets rejected or reset.
resource "aws_s3_bucket_policy" "backoffice" {
  bucket = aws_s3_bucket.backoffice.id

  depends_on = [
    aws_s3_bucket_public_access_block.backoffice,
    aws_s3_bucket_ownership_controls.backoffice,
  ]

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
