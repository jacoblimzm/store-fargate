output "app_url" {
  description = "Public app URL"
  value       = "https://${var.app_fqdn}"
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "ecr_repository_urls" {
  description = "ECR repository URLs"
  value = {
    "pay2play-backend"     = aws_ecr_repository.backend.repository_url
    "pay2play-frontend"    = aws_ecr_repository.frontend.repository_url
    "pay2play-combined-fe" = aws_ecr_repository.combined_fe.repository_url
    "pay2play-logrouter"   = aws_ecr_repository.logrouter.repository_url
  }
}

output "rds_endpoint" {
  description = "RDS endpoint address"
  value       = aws_db_instance.main.address
}

output "ecs_cluster" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}
