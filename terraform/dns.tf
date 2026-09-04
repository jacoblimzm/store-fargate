# ---------------------------------------------------------------------------
# Route 53. The hosted zone pre-exists and is referenced. We manage the four
# alias records: the public app FQDN -> CloudFront, and the origin FQDN -> ALB.
# ---------------------------------------------------------------------------

data "aws_route53_zone" "main" {
  name         = "${var.base_domain}."
  private_zone = false
}

# --- App FQDN -> CloudFront -------------------------------------------------
resource "aws_route53_record" "app_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.app_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "app_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.app_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}

# --- Origin FQDN -> ALB -----------------------------------------------------
resource "aws_route53_record" "origin_a" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.origin_fqdn
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "origin_aaaa" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.origin_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
