#!/usr/bin/env bash
# Render + register the task definition, then create (or update) an ECS service
# behind an Application Load Balancer. Use this for a durable endpoint with
# health checks. For a one-off public-IP task instead, use deploy.sh.
#
# Required env:
#   AWS_ACCOUNT_ID          e.g. 123456789012
#   AWS_REGION              e.g. us-east-1
#   ECS_CLUSTER             ECS cluster name
#   SUBNETS                 comma-separated subnet ids (>=2 AZs for the ALB)
#   SECURITY_GROUP_ID       task security group (inbound 80 from the ALB SG)
#   TARGET_GROUP_ARN        ALB target group (target-type ip, port 80)
#   DD_API_KEY_SECRET_ARN   Secrets Manager ARN for the Datadog API key
#   DB_PASSWORD_SECRET_ARN  ARN for the Postgres password
#   JWT_SECRET_ARN          ARN for the JWT signing secret
# Optional:
#   SERVICE_NAME   defaults to "pay2play"
#   DESIRED_COUNT  defaults to 1  (MUST stay 1 while Postgres runs in-task)
#   IMAGE_TAG      defaults to "latest"
#   DD_SITE        defaults to datadoghq.com
#   DD_ENV         defaults to demo
#   GRACE_PERIOD   ALB health-check grace period seconds, defaults to 120
set -euo pipefail

# Auto-load persisted deploy vars so you don't re-export in every shell.
_ENV_FILE="$(cd "$(dirname "$0")" && pwd)/deploy.env"
[ -f "$_ENV_FILE" ] && { echo ">> Sourcing $_ENV_FILE"; . "$_ENV_FILE"; }

: "${AWS_ACCOUNT_ID:?}"; : "${AWS_REGION:?}"; : "${ECS_CLUSTER:?}"
: "${SUBNETS:?}"; : "${SECURITY_GROUP_ID:?}"; : "${TARGET_GROUP_ARN:?}"
: "${DD_API_KEY_SECRET_ARN:?}"; : "${DB_PASSWORD_SECRET_ARN:?}"; : "${JWT_SECRET_ARN:?}"
: "${OPENAI_API_KEY_SECRET_ARN:?run deploy/openai-secret.sh first}"

SERVICE_NAME="${SERVICE_NAME:-pay2play}"
DESIRED_COUNT="${DESIRED_COUNT:-1}"
GRACE_PERIOD="${GRACE_PERIOD:-120}"
export IMAGE_TAG="${IMAGE_TAG:-latest}"
export DD_SITE="${DD_SITE:-datadoghq.com}"
export DD_ENV="${DD_ENV:-demo}"
# IAM role names the task def references (override to add a prefix, e.g. jake-...).
export EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-ecsTaskExecutionRole}"
export TASK_ROLE_NAME="${TASK_ROLE_NAME:-pay2playTaskRole}"
export AWS_ACCOUNT_ID AWS_REGION DD_API_KEY_SECRET_ARN DB_PASSWORD_SECRET_ARN JWT_SECRET_ARN OPENAI_API_KEY_SECRET_ARN

if [ "$DESIRED_COUNT" -gt 1 ]; then
  echo "!! WARNING: DESIRED_COUNT=$DESIRED_COUNT. Postgres runs inside the task, so"
  echo "!! each replica gets its own separately-seeded DB behind one ALB. Keep this"
  echo "!! at 1 until the database is externalized to RDS." >&2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
RENDERED="${HERE}/task-definition.rendered.json"
# awsvpc network config wants subnets without spaces: subnets=[a,b]
SUBNETS_CSV="$(echo "$SUBNETS" | tr -d ' ')"

echo ">> Rendering task definition -> ${RENDERED}"
envsubst < "${HERE}/task-definition.json" > "${RENDERED}"

echo ">> Registering task definition"
TASK_DEF_ARN=$(aws ecs register-task-definition \
  --cli-input-json "file://${RENDERED}" \
  --region "$AWS_REGION" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
echo "   ${TASK_DEF_ARN}"

NET_CONFIG="awsvpcConfiguration={subnets=[${SUBNETS_CSV}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=ENABLED}"

# Does the service already exist and is it active?
EXISTING=$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" --services "$SERVICE_NAME" --region "$AWS_REGION" \
  --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo ">> Updating existing service ${SERVICE_NAME} to new task def revision"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" --desired-count "$DESIRED_COUNT" \
    --network-configuration "$NET_CONFIG" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
else
  echo ">> Creating service ${SERVICE_NAME} behind the ALB"
  aws ecs create-service \
    --cluster "$ECS_CLUSTER" --service-name "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" --desired-count "$DESIRED_COUNT" \
    --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=frontend,containerPort=80" \
    --health-check-grace-period-seconds "$GRACE_PERIOD" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
fi

echo ">> Done. Watch rollout with:"
echo "   aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${SERVICE_NAME} --region ${AWS_REGION} --query 'services[0].deployments'"
echo "   aws elbv2 describe-target-health --target-group-arn ${TARGET_GROUP_ARN} --region ${AWS_REGION} --query 'TargetHealthDescriptions[].TargetHealth.State'"
