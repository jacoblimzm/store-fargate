# ---------------------------------------------------------------------------
# ACM certificates already exist and are DNS-validated. We reference them by
# domain (one per region) rather than managing their lifecycle.
#   - ALB listener cert lives in the app region (ap-southeast-1)
#   - CloudFront viewer cert must live in us-east-1
# ---------------------------------------------------------------------------

data "aws_acm_certificate" "alb" {
  domain      = "*.${var.base_domain}"
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_acm_certificate" "cloudfront" {
  provider    = aws.us_east_1
  domain      = "*.${var.base_domain}"
  statuses    = ["ISSUED"]
  most_recent = true
}
