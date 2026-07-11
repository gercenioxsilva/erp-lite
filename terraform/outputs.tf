output "api_url" {
  description = "Public API endpoint (CloudFront HTTPS — /v1/* proxied to NLB)"
  value       = "https://${aws_cloudfront_distribution.backoffice.domain_name}"
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

output "ecr_registry" {
  description = "ECR registry hostname (account.dkr.ecr.region.amazonaws.com)"
  value       = split("/", aws_ecr_repository.api_core.repository_url)[0]
}

output "s3_bucket_name" {
  description = "S3 bucket for the backoffice SPA"
  value       = aws_s3_bucket.backoffice.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for the backoffice"
  value       = aws_cloudfront_distribution.backoffice.id
}

output "cloudfront_domain" {
  description = "CloudFront domain where the backoffice is served"
  value       = "https://${aws_cloudfront_distribution.backoffice.domain_name}"
}

output "app_url" {
  description = "Custom domain URL for the backoffice (orquestraerp.com.br)"
  value       = "https://orquestraerp.com.br"
}

output "route53_nameservers" {
  description = "Route 53 nameservers — configure these at the domain registrar"
  value       = aws_route53_zone.main.name_servers
}

output "lambda_fiscal_name" {
  description = "Lambda fiscal-nfe function name (used by CI to force-update and wait)"
  value       = aws_lambda_function.fiscal_nfe.function_name
}

output "lambda_notifications_name" {
  description = "Lambda notifications function name (used by CI to force-update and wait)"
  value       = aws_lambda_function.notifications.function_name
}

output "lambda_billing_name" {
  description = "Lambda billing function name (used by CI to force-update and wait)"
  value       = aws_lambda_function.billing.function_name
}

output "lambda_marketplace_name" {
  description = "Lambda marketplace (Mercado Livre) function name (used by CI to force-update and wait)"
  value       = aws_lambda_function.marketplace.function_name
}

output "lambda_whatsapp_name" {
  description = "Lambda whatsapp function name (used by CI to force-update and wait)"
  value       = aws_lambda_function.whatsapp.function_name
}

output "notifications_dlq_url" {
  description = "Notifications DLQ URL (used by CI to check for failed messages)"
  value       = aws_sqs_queue.notifications_dlq.url
}

output "nfe_dlq_url" {
  description = "NF-e DLQ URL (used by CI to check for failed messages)"
  value       = aws_sqs_queue.nfe_dlq.url
}

output "marketplace_sync_dlq_url" {
  description = "Marketplace sync (Mercado Livre) DLQ URL (used by CI to check for failed messages)"
  value       = aws_sqs_queue.marketplace_sync_dlq.url
}

output "whatsapp_dlq_url" {
  description = "WhatsApp DLQ URL (used by CI to check for failed messages)"
  value       = aws_sqs_queue.whatsapp_dlq.url
}
