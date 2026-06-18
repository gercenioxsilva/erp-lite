terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "erp-lite-terraform-state"
    key    = "erp-lite/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region      = var.aws_region
  retry_mode  = "adaptive"
  max_retries = 10
}

data "aws_availability_zones" "available" { state = "available" }
data "aws_caller_identity" "current" {}

# ── VPC ────────────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = { Name = "erp-lite-vpc-${var.environment}", Environment = var.environment }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "erp-lite-igw-${var.environment}", Environment = var.environment }
}

# ── Public subnets — ECS tasks + ALB ─────────────────────────────────────────
# NOTE: ECS tasks sit in PUBLIC subnets with assign_public_ip = true.
# This eliminates the NAT Gateway (~$30/month) while still allowing
# tasks to pull ECR images and call AWS APIs over the internet.
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "erp-lite-public-${count.index + 1}-${var.environment}", Environment = var.environment }
}

# ── Private subnets — RDS only (no NAT Gateway needed) ───────────────────────
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "erp-lite-private-${count.index + 1}-${var.environment}", Environment = var.environment }
}

# ── Route tables ──────────────────────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.main.id }
  tags = { Name = "erp-lite-public-rt-${var.environment}" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private subnets have no route to internet (RDS has no outbound need)
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "erp-lite-private-rt-${var.environment}" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# ── CloudWatch Log Group ──────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "api_core" {
  name              = "/ecs/erp-lite-${var.environment}/api-core"
  retention_in_days = var.environment == "prod" ? 30 : 7
  tags = { Environment = var.environment }
}
