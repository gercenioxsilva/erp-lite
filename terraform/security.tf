# ── NLB / Load Balancer Security Group ───────────────────────────────────────
# IMPORTANT: Security Group `name` and `description` are IMMUTABLE in AWS.
# Changing either forces recreation, which triggers DependencyViolation because
# aws_security_group.api_core has an ingress rule referencing this SG's ID.
# Keep name/description as originally created; only rules can be changed in-place.
resource "aws_security_group" "alb" {
  name        = "erp-lite-alb-${var.environment}"       # immutable — do not rename
  description = "ALB - accept HTTP/HTTPS from internet" # immutable — do not change
  vpc_id      = aws_vpc.main.id

  # HTTP 80 — CloudFront forwards API traffic to NLB over HTTP.
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # HTTPS 443 intentionally removed — CloudFront terminates TLS; NLB only needs port 80.

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "erp-lite-nlb-sg-${var.environment}", Environment = var.environment }
}

# ── ECS / API Core Security Group ────────────────────────────────────────────
# IMPORTANT: description is IMMUTABLE — keep value as originally deployed.
resource "aws_security_group" "api_core" {
  name        = "erp-lite-api-core-${var.environment}"
  description = "API Core - accept traffic from ALB only" # immutable — do not change
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Outbound: internet (ECR, CloudWatch, RDS within VPC)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "erp-lite-api-core-sg-${var.environment}", Environment = var.environment }
}

# ── RDS Security Group ────────────────────────────────────────────────────────
resource "aws_security_group" "rds" {
  name        = "erp-lite-rds-${var.environment}"
  description = "RDS - accept PostgreSQL from api-core only"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api_core.id]
  }

  tags = { Name = "erp-lite-rds-sg-${var.environment}", Environment = var.environment }
}
