# ── ALB Security Group ────────────────────────────────────────────────────────
resource "aws_security_group" "alb" {
  name        = "erp-lite-alb-${var.environment}"
  description = "ALB - accept HTTP/HTTPS from internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "erp-lite-alb-sg-${var.environment}", Environment = var.environment }
}

# ── ECS / API Core Security Group ────────────────────────────────────────────
resource "aws_security_group" "api_core" {
  name        = "erp-lite-api-core-${var.environment}"
  description = "API Core - accept traffic from ALB only"
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
