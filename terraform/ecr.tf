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
