#!/usr/bin/env bash
# Render the task definition, register it, and run it as a single public-IP
# Fargate task (simplest path for a test). For a stable endpoint, place the
# task behind an ALB instead (see deploy/README.md).
#
# Required env:
#   AWS_ACCOUNT_ID          e.g. 123456789012
#   AWS_REGION              e.g. us-east-1
#   ECS_CLUSTER             ECS cluster name
#   SUBNET_ID               public subnet id (or comma-separated list)
#   SECURITY_GROUP_ID       security group allowing inbound 80
#   DD_API_KEY_SECRET_ARN   Secrets Manager / SSM ARN for the Datadog API key
#   DB_PASSWORD_SECRET_ARN  ARN for the Postgres password
#   JWT_SECRET_ARN          ARN for the JWT signing secret
# Optional:
#   IMAGE_TAG   defaults to "latest"
#   DD_SITE     defaults to datadoghq.com
#   DD_ENV      defaults to demo
set -euo pipefail

# Auto-load persisted deploy vars so you don't re-export in every shell.
_ENV_FILE="$(cd "$(dirname "$0")" && pwd)/deploy.env"
[ -f "$_ENV_FILE" ] && { echo ">> Sourcing $_ENV_FILE"; . "$_ENV_FILE"; }

: "${AWS_ACCOUNT_ID:?}"; : "${AWS_REGION:?}"; : "${ECS_CLUSTER:?}"
: "${SUBNET_ID:?}"; : "${SECURITY_GROUP_ID:?}"
: "${DD_API_KEY_SECRET_ARN:?}"; : "${DB_PASSWORD_SECRET_ARN:?}"; : "${JWT_SECRET_ARN:?}"

export IMAGE_TAG="${IMAGE_TAG:-latest}"
export DD_SITE="${DD_SITE:-datadoghq.com}"
export DD_ENV="${DD_ENV:-demo}"
# IAM role names the task def references (override to add a prefix, e.g. jake-...).
export EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-ecsTaskExecutionRole}"
export TASK_ROLE_NAME="${TASK_ROLE_NAME:-pay2playTaskRole}"
export AWS_ACCOUNT_ID AWS_REGION DD_API_KEY_SECRET_ARN DB_PASSWORD_SECRET_ARN JWT_SECRET_ARN

HERE="$(cd "$(dirname "$0")" && pwd)"
RENDERED="${HERE}/task-definition.rendered.json"

echo ">> Rendering task definition -> ${RENDERED}"
envsubst < "${HERE}/task-definition.json" > "${RENDERED}"

echo ">> Registering task definition"
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${RENDERED}" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
echo "   ${TASK_DEF_ARN}"

echo ">> Running task on cluster ${ECS_CLUSTER}"
aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEF_ARN" \
  --region "$AWS_REGION" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_ID}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text

echo ">> Task launched. Find its public IP in the ECS console or via:"
echo "   aws ecs describe-tasks --cluster ${ECS_CLUSTER} --tasks <taskArn> --region ${AWS_REGION}"
