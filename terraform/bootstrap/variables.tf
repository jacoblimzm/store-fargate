variable "region" {
  description = "AWS region for the Terraform state backend resources"
  type        = string
  default     = "ap-southeast-1"
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
  default     = "369042512949"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket that stores Terraform remote state"
  type        = string
  default     = "pay2play-tfstate-369042512949"
}

variable "lock_table_name" {
  description = "DynamoDB table used for Terraform state locking"
  type        = string
  default     = "pay2play-tf-locks"
}

variable "github_owner" {
  description = "GitHub org/user that owns the repo allowed to assume the deploy role"
  type        = string
  default     = "jacoblimzm"
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deploy role via OIDC"
  type        = string
  default     = "store-fargate"
}

variable "github_owner_id" {
  description = "Immutable numeric ID of the GitHub owner (from the OIDC sub claim)"
  type        = string
  default     = "71201187"
}

variable "github_repo_id" {
  description = "Immutable numeric ID of the GitHub repo (from the OIDC sub claim)"
  type        = string
  default     = "1348342696"
}

variable "deploy_role_name" {
  description = "Name of the IAM role assumed by GitHub Actions"
  type        = string
  default     = "github-actions-pay2play-deploy"
}
