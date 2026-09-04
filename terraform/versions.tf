terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# Primary region for the application stack.
provider "aws" {
  region = var.region
}

# us-east-1 is required for the CloudFront viewer certificate (ACM).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
