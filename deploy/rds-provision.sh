#!/usr/bin/env bash
# Phase 1 of the split: provision a managed Amazon RDS for PostgreSQL instance to
# replace the in-task `db` container. Idempotent -- safe to re-run.
#
# What it does:
#   1. DB subnet group across your SUBNETS (>=2 AZs)
#   2. Security group allowing 5432 ONLY from the task SG
#   3. Parameter group with pg_stat_statements preloaded (for Datadog DBM later)
#   4. RDS Postgres instance (private, cheap defaults)
#   5. Stores the full DATABASE_URL in Secrets Manager, records the ARN in
#      deploy.env, and grants the ECS execution role permission to read it.
#
# Cost note: creates a db.t4g.micro + 20GB gp3 (single-AZ). Delete when done:
#   aws rds delete-db-instance --db-instance-identifier pay2play-db \
#     --skip-final-snapshot --region <region>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/deploy.env" ] && . "$HERE/deploy.env"

: "${AWS_REGION:?set AWS_REGION in deploy.env}"
: "${VPC_ID:?set VPC_ID in deploy.env}"
: "${SUBNETS:?set SUBNETS in deploy.env}"
: "${TASK_SG:?set TASK_SG in deploy.env}"
: "${EXECUTION_ROLE_NAME:?set EXECUTION_ROLE_NAME in deploy.env}"

DB_ID="${DB_ID:-pay2play-db}"
DB_NAME="${DB_NAME:-pay2play}"
DB_USER="${DB_USER:-pay2play}"
DB_CLASS="${DB_CLASS:-db.t4g.micro}"
DB_STORAGE="${DB_STORAGE:-20}"
ENGINE_VERSION="${ENGINE_VERSION:-16}"
PARAM_FAMILY="${PARAM_FAMILY:-postgres16}"
SUBNET_GROUP="pay2play-db-subnets"
PARAM_GROUP="pay2play-pg16"
RDS_SG_NAME="pay2play-rds-sg"

echo ">> [1/6] DB subnet group ${SUBNET_GROUP}"
SUBNET_IDS_CSV="$(echo "$SUBNETS" | tr ',' ' ')"
if ! aws rds describe-db-subnet-groups --db-subnet-group-name "$SUBNET_GROUP" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws rds create-db-subnet-group \
    --db-subnet-group-name "$SUBNET_GROUP" \
    --db-subnet-group-description "pay2play RDS subnets" \
    --subnet-ids $SUBNET_IDS_CSV \
    --region "$AWS_REGION" >/dev/null
fi

echo ">> [2/6] RDS security group ${RDS_SG_NAME} (ingress 5432 from ${TASK_SG})"
RDS_SG_ID="$(aws ec2 describe-security-groups --region "$AWS_REGION" \
  --filters "Name=group-name,Values=${RDS_SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$RDS_SG_ID" ] || [ "$RDS_SG_ID" = "None" ]; then
  RDS_SG_ID="$(aws ec2 create-security-group --region "$AWS_REGION" \
    --group-name "$RDS_SG_NAME" --description "pay2play RDS" --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)"
fi
# Idempotent ingress: allow 5432 from the task SG (ignore "already exists").
aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
  --group-id "$RDS_SG_ID" --protocol tcp --port 5432 --source-group "$TASK_SG" \
  >/dev/null 2>&1 || true

echo ">> [3/6] Parameter group ${PARAM_GROUP} (pg_stat_statements)"
if ! aws rds describe-db-parameter-groups --db-parameter-group-name "$PARAM_GROUP" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws rds create-db-parameter-group \
    --db-parameter-group-name "$PARAM_GROUP" \
    --db-parameter-group-family "$PARAM_FAMILY" \
    --description "pay2play postgres params" --region "$AWS_REGION" >/dev/null
fi
aws rds modify-db-parameter-group --db-parameter-group-name "$PARAM_GROUP" --region "$AWS_REGION" \
  --parameters "ParameterName=shared_preload_libraries,ParameterValue=pg_stat_statements,ApplyMethod=pending-reboot" \
  >/dev/null

echo ">> [4/6] RDS instance ${DB_ID} (${DB_CLASS}, ${DB_STORAGE}GB)"
if aws rds describe-db-instances --db-instance-identifier "$DB_ID" --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "   already exists, reusing"
  DB_PASSWORD="$(aws secretsmanager get-secret-value --secret-id pay2play/rds-master-password \
    --region "$AWS_REGION" --query SecretString --output text 2>/dev/null || true)"
  if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "None" ]; then
    echo "!! Instance exists but master password secret missing; cannot rebuild DATABASE_URL." >&2
    echo "!! Rotate the password or delete the instance to re-provision." >&2
    exit 1
  fi
else
  DB_PASSWORD="$(openssl rand -hex 20)"
  aws secretsmanager create-secret --name pay2play/rds-master-password \
    --secret-string "$DB_PASSWORD" --region "$AWS_REGION" >/dev/null 2>&1 \
    || aws secretsmanager put-secret-value --secret-id pay2play/rds-master-password \
       --secret-string "$DB_PASSWORD" --region "$AWS_REGION" >/dev/null
  aws rds create-db-instance \
    --db-instance-identifier "$DB_ID" \
    --db-instance-class "$DB_CLASS" \
    --engine postgres --engine-version "$ENGINE_VERSION" \
    --allocated-storage "$DB_STORAGE" --storage-type gp3 \
    --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" \
    --db-name "$DB_NAME" \
    --db-subnet-group-name "$SUBNET_GROUP" \
    --vpc-security-group-ids "$RDS_SG_ID" \
    --db-parameter-group-name "$PARAM_GROUP" \
    --no-publicly-accessible \
    --backup-retention-period 1 \
    --region "$AWS_REGION" >/dev/null
fi

echo "   waiting for ${DB_ID} to become available (this can take several minutes)..."
aws rds wait db-instance-available --db-instance-identifier "$DB_ID" --region "$AWS_REGION"

ENDPOINT="$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --region "$AWS_REGION" \
  --query 'DBInstances[0].Endpoint.Address' --output text)"
echo "   endpoint: ${ENDPOINT}"

echo ">> [5/6] Storing DATABASE_URL secret + recording ARN in deploy.env"
DATABASE_URL="postgresql+psycopg2://${DB_USER}:${DB_PASSWORD}@${ENDPOINT}:5432/${DB_NAME}"
aws secretsmanager create-secret --name pay2play/database-url \
  --secret-string "$DATABASE_URL" --region "$AWS_REGION" >/dev/null 2>&1 \
  || aws secretsmanager put-secret-value --secret-id pay2play/database-url \
     --secret-string "$DATABASE_URL" --region "$AWS_REGION" >/dev/null
DB_URL_ARN="$(aws secretsmanager describe-secret --secret-id pay2play/database-url \
  --region "$AWS_REGION" --query ARN --output text)"

if grep -q '^DATABASE_URL_SECRET_ARN=' "$HERE/deploy.env"; then
  sed -i.bak "s#^DATABASE_URL_SECRET_ARN=.*#DATABASE_URL_SECRET_ARN=${DB_URL_ARN}#" "$HERE/deploy.env"
  rm -f "$HERE/deploy.env.bak"
else
  printf '\n# Phase 1 (RDS): DATABASE_URL secret (created by rds-provision.sh)\nDATABASE_URL_SECRET_ARN=%s\nRDS_ENDPOINT=%s\n' "$DB_URL_ARN" "$ENDPOINT" >> "$HERE/deploy.env"
fi

echo ">> [6/6] Granting ${EXECUTION_ROLE_NAME} read access to the DATABASE_URL secret"
aws iam put-role-policy \
  --role-name "$EXECUTION_ROLE_NAME" \
  --policy-name pay2play-database-url-secret \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"secretsmanager:GetSecretValue\",
      \"Resource\": \"${DB_URL_ARN}\"
    }]
  }"

echo ">> Done. RDS ${DB_ID} ready; DATABASE_URL_SECRET_ARN written to deploy.env."
echo "   Next: deploy the updated task def (db container removed, backend -> RDS)."
