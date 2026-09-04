# ---------------------------------------------------------------------------
# CloudFront distribution fronting the ALB. Managed AWS cache/origin-request
# policies are used (CachingDisabled + AllViewer).
# ---------------------------------------------------------------------------

locals {
  # AWS managed policies (stable IDs).
  cf_cache_policy_caching_disabled   = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cf_origin_request_policy_allviewer = "216adef6-5c7f-47e4-b989-5492eafa07d3"
}

resource "aws_cloudfront_distribution" "main" {
  enabled         = true
  aliases         = [var.app_fqdn]
  comment         = "pay2play front - CloudFront edge for ${var.app_fqdn}"
  price_class     = "PriceClass_All"
  http_version    = "http2and3"
  is_ipv6_enabled = true

  origin {
    origin_id   = "alb-origin"
    domain_name = var.origin_fqdn

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }

    connection_attempts = 3
    connection_timeout  = 10
  }

  default_cache_behavior {
    target_origin_id       = "alb-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = local.cf_cache_policy_caching_disabled
    origin_request_policy_id = local.cf_origin_request_policy_allviewer
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.cloudfront.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
