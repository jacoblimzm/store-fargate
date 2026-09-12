# ---------------------------------------------------------------------------
# Secrets are referenced by ARN only. Values are NEVER read into Terraform
# state or code - ECS resolves them at container start via the execution role.
# ---------------------------------------------------------------------------

data "aws_secretsmanager_secret" "dd_api_key" {
  name = "jakedog/dd_api_key"
}

data "aws_secretsmanager_secret" "database_url" {
  name = "pay2play/database-url"
}

data "aws_secretsmanager_secret" "jwt_secret" {
  name = "pay2play/jwt-secret"
}

data "aws_secretsmanager_secret" "openai_api_key" {
  name = "pay2play/openai_api_key"
}

# Password for the `datadog` Postgres user used by the DBM Agent check.
# Value is populated out-of-band (like the other secrets); create the DB user
# with this same password on RDS.
data "aws_secretsmanager_secret" "datadog_pg_password" {
  name = "pay2play/datadog-pg-password"
}
