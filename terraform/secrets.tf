# ---------------------------------------------------------------------------
# Secrets are referenced by ARN only. Values are NEVER read into Terraform
# state or code - ECS resolves them at container start via the execution role.
#
# ⚠️ IAM coupling (managed OUT-OF-BAND, not in this Terraform):
# The shared execution role (var.execution_role_name) is referenced, not
# managed here (see iam.tf), so each secret needs a matching inline policy
# granting `secretsmanager:GetSecretValue` on that secret's ARN. Without it the
# task fails to start with a ResourceInitializationError (AccessDeniedException)
# and never even creates its CloudWatch log group.
#
# Convention: one inline policy per secret on the execution role, e.g.
#   pay2play-database-url-secret, pay2play-openai-secret,
#   pay2play-datadog-pg-password-secret
#
# When ADDING a secret here, also add its grant, e.g.:
#   aws iam put-role-policy --role-name <execution_role_name> \
#     --policy-name pay2play-<secret>-secret \
#     --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
#       "Action":"secretsmanager:GetSecretValue","Resource":"<secret-arn>"}]}'
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
