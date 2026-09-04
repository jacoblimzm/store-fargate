output "state_bucket" {
  description = "S3 bucket for Terraform remote state"
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "DynamoDB table for Terraform state locking"
  value       = aws_dynamodb_table.locks.name
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions to assume via OIDC"
  value       = aws_iam_role.github_deploy.arn
}
