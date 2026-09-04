variable "region" {
  description = "Primary AWS region for the app stack"
  type        = string
  default     = "ap-southeast-1"
}

variable "account_id" {
  description = "AWS account ID"
  type        = string
  default     = "369042512949"
}

variable "project" {
  description = "Project/name prefix for resources"
  type        = string
  default     = "pay2play"
}

variable "base_domain" {
  description = "Route 53 hosted zone / base domain"
  type        = string
  default     = "dogdysseus.ai"
}

variable "app_fqdn" {
  description = "Public app FQDN served by CloudFront"
  type        = string
  default     = "pay2play.dogdysseus.ai"
}

variable "origin_fqdn" {
  description = "ALB origin FQDN that CloudFront connects to"
  type        = string
  default     = "alb-origin.dogdysseus.ai"
}

# --- Existing shared networking (referenced, not managed) -------------------
variable "vpc_id" {
  description = "Existing VPC that hosts the app"
  type        = string
  default     = "vpc-0169d769cd12ce2ae"
}

variable "public_subnet_ids" {
  description = "Public subnets used by the ALB, ECS services and RDS subnet group"
  type        = list(string)
  default     = ["subnet-0290a107f38bbea6c", "subnet-038b7a2bbe4ab3223"]
}

variable "cloudfront_prefix_list_id" {
  description = "Managed prefix list for CloudFront origin-facing IPs (com.amazonaws.global.cloudfront.origin-facing)"
  type        = string
  default     = "pl-31a34658"
}

# --- Existing IAM roles (referenced, not managed) ---------------------------
variable "execution_role_name" {
  description = "ECS task execution role name"
  type        = string
  default     = "jakeecsTaskExecutionRole"
}

variable "task_role_name" {
  description = "ECS task role name"
  type        = string
  default     = "jakepay2playTaskRole"
}

# --- Datadog + app config ----------------------------------------------------
variable "dd_site" {
  description = "Datadog intake site"
  type        = string
  default     = "datadoghq.com"
}

variable "dd_env" {
  description = "Datadog environment tag"
  type        = string
  default     = "production"
}

variable "dd_version" {
  description = "Datadog version tag for the app containers"
  type        = string
  default     = "0.1.0"
}

variable "dd_llmobs_ml_app" {
  description = "Datadog LLM Observability ML app name"
  type        = string
  default     = "pay2play-chatbot"
}

variable "openai_model" {
  description = "OpenAI model used by the chatbot backend"
  type        = string
  default     = "gpt-5-mini"
}

variable "image_tag" {
  description = "Container image tag deployed to ECS (git SHA in CI, 'latest' locally)"
  type        = string
  default     = "latest"
}
