output "api_url" {
  description = "Public API endpoint (ALB DNS)"
  value       = "http://${aws_lb.main.dns_name}"
}

output "rds_endpoint" {
  description = "RDS endpoint (internal VPC only)"
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "ecr_repository_url" {
  description = "ECR repository URL for api-core"
  value       = aws_ecr_repository.api_core.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.api_core.name
}

output "ecs_task_definition_family" {
  description = "ECS task definition family name (used for run-task in CI)"
  value       = aws_ecs_task_definition.api_core.family
}

output "public_subnet_ids" {
  description = "Comma-separated public subnet IDs (used for ECS run-task in CI)"
  value       = join(",", aws_subnet.public[*].id)
}

output "api_security_group_id" {
  description = "Security group ID for api-core ECS tasks"
  value       = aws_security_group.api_core.id
}
