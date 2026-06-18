resource "aws_ecr_repository" "api_core" {
  name                 = "erp-lite/api-core"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }

  tags = { Environment = var.environment }
}

# Keep only the 10 most recent images — free up storage cost
resource "aws_ecr_lifecycle_policy" "api_core" {
  repository = aws_ecr_repository.api_core.name

  policy = jsonencode({
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
