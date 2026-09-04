# ---------------------------------------------------------------------------
# Networking. The VPC and subnets pre-exist and are shared, so they are
# referenced (data sources), not managed. The three app security groups ARE
# managed (imported).
# ---------------------------------------------------------------------------

data "aws_vpc" "main" {
  id = var.vpc_id
}

# --- ALB security group -----------------------------------------------------
# Ingress locked to CloudFront origin-facing IPs on 443 (CloudFront fronts the
# ALB). Egress open.
resource "aws_security_group" "alb" {
  name        = "${var.project}-alb-sg"
  description = "pay2play ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTPS from CloudFront origin-facing IPs"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [var.cloudfront_prefix_list_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-alb-sg"
  }
}

# --- ECS task security group ------------------------------------------------
# Port 80 reachable from the ALB SG (plus a legacy dev /32 that can be removed),
# and full self-ingress so Service Connect sidecars can talk to each other.
resource "aws_security_group" "task" {
  name        = "${var.project}-task-sg"
  description = "pay2play tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP from ALB (and legacy dev IP)"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    cidr_blocks     = ["116.88.89.199/32"] # legacy dev IP - safe to remove later
  }

  ingress {
    description = "All traffic between tasks (Service Connect)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-task-sg"
  }
}

# --- RDS security group -----------------------------------------------------
resource "aws_security_group" "rds" {
  name        = "${var.project}-rds-sg"
  description = "pay2play RDS"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project}-rds-sg"
  }
}
