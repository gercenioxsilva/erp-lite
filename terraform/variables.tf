variable "environment" {
  description = "Environment name: dev | staging | prod"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

# ── Cost knobs ─────────────────────────────────────────────────────────────────
# dev:  db.t3.micro (1 vCPU, 1 GB) — ~$13/month single-AZ
# prod: db.t3.small (2 vCPU, 2 GB) — ~$27/month single-AZ
variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

# dev:  1 task (zero HA, minimum cost)
# prod: 2 tasks minimum for high availability
variable "api_desired_count" {
  type    = number
  default = 1
}

# ECS task size — Fargate minimum: 256 CPU / 512 MB ≈ $9/month
variable "api_cpu" {
  type    = number
  default = 256
}

variable "api_memory" {
  type    = number
  default = 512
}

# ── Secrets (pass via TF_VAR_* or CI/CD secrets) ──────────────────────────────
variable "db_password" {
  description = "RDS master password — store in CI secrets, never commit"
  type        = string
  sensitive   = true
  default     = "change-me-before-deploy"
}

variable "jwt_secret" {
  description = "JWT signing secret for the auth service"
  type        = string
  sensitive   = true
  default     = "change-me-jwt-secret"
}
