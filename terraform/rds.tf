# ---------------------------------------------------------------------------
# RDS PostgreSQL. The instance holds real data, so it is imported and managed
# in place. The master password is set out-of-band (Secrets Manager) and is
# never managed by Terraform.
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "${var.project}-db-subnets"
  description = "pay2play RDS subnets"
  subnet_ids  = var.public_subnet_ids
}

resource "aws_db_parameter_group" "pg16" {
  name        = "${var.project}-pg16"
  family      = "postgres16"
  description = "pay2play postgres params"

  # Datadog DBM: load pg_stat_statements + capture larger query text and richer
  # query stats (per the RDS Postgres DBM setup docs). The postmaster-context
  # params take effect after a reboot.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "track_activity_query_size"
    value        = "4096"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "pg_stat_statements.track"
    value        = "all"
    apply_method = "immediate"
  }

  parameter {
    name         = "track_io_timing"
    value        = "on"
    apply_method = "immediate"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16.13"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = "pay2play"
  username = "pay2play"
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  parameter_group_name   = aws_db_parameter_group.pg16.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  availability_zone      = "${var.region}b"

  publicly_accessible     = false
  multi_az                = false
  storage_encrypted       = false
  backup_retention_period = 1
  backup_window           = "19:36-20:06"
  maintenance_window      = "wed:16:00-wed:16:30"

  auto_minor_version_upgrade   = true
  ca_cert_identifier           = "rds-ca-rsa2048-g1"
  license_model                = "postgresql-license"
  monitoring_interval          = 0
  performance_insights_enabled = false

  deletion_protection = false
  skip_final_snapshot = true

  lifecycle {
    # Password is managed out-of-band via Secrets Manager and is not readable.
    ignore_changes = [password]
  }
}
