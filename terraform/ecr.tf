locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_repository" "api_core" {
  name                 = "erp-lite/api-core"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Environment = var.environment }
}

resource "aws_ecr_lifecycle_policy" "api_core" {
  repository = aws_ecr_repository.api_core.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_repository" "lambda_fiscal" {
  name                 = "erp-lite/lambda-fiscal"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Environment = var.environment }
}

resource "aws_ecr_lifecycle_policy" "lambda_fiscal" {
  repository = aws_ecr_repository.lambda_fiscal.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_repository" "lambda_notifications" {
  name                 = "erp-lite/lambda-notifications"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Environment = var.environment }
}

resource "aws_ecr_lifecycle_policy" "lambda_notifications" {
  repository = aws_ecr_repository.lambda_notifications.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_repository" "lambda_billing" {
  name                 = "erp-lite/lambda-billing"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Environment = var.environment }
}

resource "aws_ecr_lifecycle_policy" "lambda_billing" {
  repository = aws_ecr_repository.lambda_billing.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_repository" "lambda_marketplace" {
  name                 = "erp-lite/lambda-marketplace"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = { Environment = var.environment }
}

resource "aws_ecr_lifecycle_policy" "lambda_marketplace" {
  repository = aws_ecr_repository.lambda_marketplace.name
  policy     = local.ecr_lifecycle_policy
}
