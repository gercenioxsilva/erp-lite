# ── Route 53 Hosted Zone ──────────────────────────────────────────────────────
resource "aws_route53_zone" "main" {
  name = "orquestraerp.com.br"
  tags = { Environment = var.environment }
}

# ── ACM certificate DNS validation records ────────────────────────────────────
# These CNAMEs prove domain ownership. ACM validates automatically once the
# domain registrar nameservers point to this Route 53 hosted zone.
# No waiter resource here — validation is async and must not block CI.
resource "aws_route53_record" "acm_validation_apex" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_6953e041399d4a423bf6f785eba5b5de"
  type    = "CNAME"
  ttl     = 300
  records = ["_5ddceab494e2c8b382baa7902ed59ed0.jkddzztszm.acm-validations.aws."]
}

resource "aws_route53_record" "acm_validation_www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_0291e11d95625b2da0721e9f67875b7f.www"
  type    = "CNAME"
  ttl     = 300
  records = ["_80c0a4583041b77c10a5b37bf99c2b99.jkddzztszm.acm-validations.aws."]
}

# ── Route 53 — A alias records pointing to CloudFront ────────────────────────
# Created immediately so DNS resolves as soon as the registrar is updated.
# CloudFront will only accept these hostnames after acm_certificate_arn is set.
resource "aws_route53_record" "apex" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "orquestraerp.com.br"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.backoffice.domain_name
    zone_id                = aws_cloudfront_distribution.backoffice.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "www.orquestraerp.com.br"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.backoffice.domain_name
    zone_id                = aws_cloudfront_distribution.backoffice.hosted_zone_id
    evaluate_target_health = false
  }
}
