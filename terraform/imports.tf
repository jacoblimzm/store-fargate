# ---------------------------------------------------------------------------
# Adoption of existing resources into Terraform state (Terraform 1.5+ import
# blocks). These run on the next `terraform apply`/`plan -generate-config` and
# can be deleted once the resources are in state and plans are clean.
#
# NOTE: ECS task definitions are intentionally NOT imported - Terraform
# registers a fresh, equivalent revision on first apply and the services roll
# to it with zero downtime.
# ---------------------------------------------------------------------------

# --- Security groups --------------------------------------------------------
import {
  to = aws_security_group.alb
  id = "sg-00eee71feab21798f"
}

import {
  to = aws_security_group.task
  id = "sg-04173355d257bfc3f"
}

import {
  to = aws_security_group.rds
  id = "sg-0b457e02ea8e71370"
}

# --- ALB / target group / listeners ----------------------------------------
import {
  to = aws_lb.main
  id = "arn:aws:elasticloadbalancing:ap-southeast-1:369042512949:loadbalancer/app/pay2play-alb/134ca99bb3a71660"
}

import {
  to = aws_lb_target_group.main
  id = "arn:aws:elasticloadbalancing:ap-southeast-1:369042512949:targetgroup/pay2play-tg/5485349b0ac1fe01"
}

import {
  to = aws_lb_listener.http
  id = "arn:aws:elasticloadbalancing:ap-southeast-1:369042512949:listener/app/pay2play-alb/134ca99bb3a71660/16fb956a7c65a417"
}

import {
  to = aws_lb_listener.https
  id = "arn:aws:elasticloadbalancing:ap-southeast-1:369042512949:listener/app/pay2play-alb/134ca99bb3a71660/4fb77a40e48db8da"
}

import {
  to = aws_lb_listener_rule.app
  id = "arn:aws:elasticloadbalancing:ap-southeast-1:369042512949:listener-rule/app/pay2play-alb/134ca99bb3a71660/4fb77a40e48db8da/ad7724001f549aa0"
}

# --- ECR --------------------------------------------------------------------
import {
  to = aws_ecr_repository.backend
  id = "pay2play-backend"
}

import {
  to = aws_ecr_repository.frontend
  id = "pay2play-frontend"
}

import {
  to = aws_ecr_repository.combined_fe
  id = "pay2play-combined-fe"
}

import {
  to = aws_ecr_repository.logrouter
  id = "pay2play-logrouter"
}

# --- RDS --------------------------------------------------------------------
import {
  to = aws_db_subnet_group.main
  id = "pay2play-db-subnets"
}

import {
  to = aws_db_parameter_group.pg16
  id = "pay2play-pg16"
}

import {
  to = aws_db_instance.main
  id = "pay2play-db"
}

# --- CloudFront -------------------------------------------------------------
import {
  to = aws_cloudfront_distribution.main
  id = "ECEICK9XMVRCI"
}

# --- Route 53 records -------------------------------------------------------
import {
  to = aws_route53_record.app_a
  id = "Z0879253LUEWLFM1WDKO_pay2play.dogdysseus.ai_A"
}

import {
  to = aws_route53_record.app_aaaa
  id = "Z0879253LUEWLFM1WDKO_pay2play.dogdysseus.ai_AAAA"
}

import {
  to = aws_route53_record.origin_a
  id = "Z0879253LUEWLFM1WDKO_alb-origin.dogdysseus.ai_A"
}

import {
  to = aws_route53_record.origin_aaaa
  id = "Z0879253LUEWLFM1WDKO_alb-origin.dogdysseus.ai_AAAA"
}

# --- ECS --------------------------------------------------------------------
import {
  to = aws_ecs_cluster.main
  id = "pay2playcluster"
}

import {
  to = aws_service_discovery_http_namespace.main
  id = "ns-hyxgatxf4qefhmus"
}

import {
  to = aws_ecs_service.backend
  id = "pay2playcluster/pay2play-backend"
}

import {
  to = aws_ecs_service.frontend
  id = "pay2playcluster/pay2play-frontend"
}

import {
  to = aws_ecs_service.combined_fe
  id = "pay2playcluster/pay2play-combined-fe"
}
