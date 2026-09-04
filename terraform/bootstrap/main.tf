# ---------------------------------------------------------------------------
# Bootstrap: remote state backend + GitHub Actions OIDC deploy role.
#
# This root uses LOCAL state (committed alongside the code) and is applied ONCE
# by a human with admin credentials. Everything else (the app stack under
# terraform/) uses the S3 backend created here.
# ---------------------------------------------------------------------------

# --- Remote state: S3 bucket -------------------------------------------------
resource "aws_s3_bucket" "state" {
  bucket = var.state_bucket_name

  tags = {
    Name    = var.state_bucket_name
    Project = "pay2play"
    Purpose = "terraform-remote-state"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Remote state: DynamoDB lock table --------------------------------------
resource "aws_dynamodb_table" "locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name    = var.lock_table_name
    Project = "pay2play"
    Purpose = "terraform-state-lock"
  }
}

# --- GitHub Actions OIDC deploy role ----------------------------------------
# The GitHub OIDC provider already exists in this (shared) account, so we
# reference it rather than creating it.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # GitHub issues immutable-ID subjects
    # (repo:OWNER@OWNER_ID/REPO@REPO_ID:...), so pin the repo by its immutable
    # numeric IDs and restrict the ref via a sub wildcard. This is rename-safe
    # and format-agnostic (works for both legacy and immutable subjects).
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_owner_id"
      values   = [var.github_owner_id]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_id"
      values   = [var.github_repo_id]
    }

    # Allow the main branch and pull requests only.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:*:ref:refs/heads/main",
        "repo:*:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = var.deploy_role_name
  assume_role_policy = data.aws_iam_policy_document.github_assume.json

  tags = {
    Project = "pay2play"
    Purpose = "github-actions-deploy"
  }
}

data "aws_iam_policy_document" "deploy" {
  # Terraform state access.
  statement {
    sid       = "TerraformState"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning"]
    resources = [aws_s3_bucket.state.arn]
  }
  statement {
    sid       = "TerraformStateObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    sid       = "TerraformLock"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.locks.arn]
  }

  # Application infrastructure managed by the terraform/ stack.
  statement {
    sid    = "AppInfra"
    effect = "Allow"
    actions = [
      "ecr:*",
      "ecs:*",
      "elasticloadbalancing:*",
      "cloudfront:*",
      "acm:Describe*",
      "acm:List*",
      "acm:GetCertificate",
      "route53:*",
      "rds:*",
      "servicediscovery:*",
      "logs:*",
      "application-autoscaling:*",
    ]
    resources = ["*"]
  }

  # Read-only secrets + EC2/networking needed to plan/apply.
  statement {
    sid    = "SecretsAndNetworking"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecrets",
      "ec2:Describe*",
      "ec2:AuthorizeSecurityGroup*",
      "ec2:RevokeSecurityGroup*",
      "ec2:CreateSecurityGroup",
      "ec2:DeleteSecurityGroup",
      "ec2:ModifySecurityGroupRules",
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:GetManagedPrefixListEntries",
      "iam:GetRole",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:GetRolePolicy",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }

  # Pass the existing task/execution roles to ECS only.
  statement {
    sid     = "PassEcsRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${var.account_id}:role/jakeecsTaskExecutionRole",
      "arn:aws:iam::${var.account_id}:role/jakepay2playTaskRole",
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "pay2play-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
