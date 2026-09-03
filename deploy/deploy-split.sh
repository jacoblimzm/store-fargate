#!/usr/bin/env bash
# Phase 2: split the monolith task into three independent services in one cluster:
#   - pay2play-backend     (internal; Service Connect server, advertises backend:8000)
#   - pay2play-frontend    (public via the ALB; Service Connect client -> backend)
#   - pay2play-combined-fe (the FireLens log-split/redaction demo)
#
# Each task carries its own datadog-agent + log_router sidecars. Frontend reaches
# the backend over ECS Service Connect (DNS name "backend"), not localhost.
#
# Idempotent: creates services if missing, otherwise updates them. Safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/deploy.env" ] && { echo ">> Sourcing $HERE/deploy.env"; . "$HERE/deploy.env"; }

: "${AWS_ACCOUNT_ID:?}"; : "${AWS_REGION:?}"; : "${ECS_CLUSTER:?}"
: "${SUBNETS:?}"; : "${SECURITY_GROUP_ID:?}"; : "${TARGET_GROUP_ARN:?}"
: "${DD_API_KEY_SECRET_ARN:?}"; : "${JWT_SECRET_ARN:?}"
: "${OPENAI_API_KEY_SECRET_ARN:?run deploy/openai-secret.sh first}"
: "${DATABASE_URL_SECRET_ARN:?run deploy/rds-provision.sh first}"

export IMAGE_TAG="${IMAGE_TAG:-latest}"
export DD_SITE="${DD_SITE:-datadoghq.com}"
export DD_ENV="${DD_ENV:-demo}"
export EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-ecsTaskExecutionRole}"
export TASK_ROLE_NAME="${TASK_ROLE_NAME:-pay2playTaskRole}"
export AWS_ACCOUNT_ID AWS_REGION DD_API_KEY_SECRET_ARN JWT_SECRET_ARN \
  OPENAI_API_KEY_SECRET_ARN DATABASE_URL_SECRET_ARN

NAMESPACE_NAME="${SC_NAMESPACE:-pay2play}"
GRACE_PERIOD="${GRACE_PERIOD:-120}"
SUBNETS_CSV="$(echo "$SUBNETS" | tr -d ' ')"
NET_CONFIG="awsvpcConfiguration={subnets=[${SUBNETS_CSV}],securityGroups=[${SECURITY_GROUP_ID}],assignPublicIp=ENABLED}"

echo ">> [1/6] Service Connect namespace '${NAMESPACE_NAME}'"
NS_ARN="$(aws servicediscovery list-namespaces --region "$AWS_REGION" \
  --query "Namespaces[?Name=='${NAMESPACE_NAME}'].Arn | [0]" --output text 2>/dev/null || true)"
if [ -z "$NS_ARN" ] || [ "$NS_ARN" = "None" ]; then
  OP_ID="$(aws servicediscovery create-http-namespace --name "$NAMESPACE_NAME" \
    --region "$AWS_REGION" --query OperationId --output text)"
  echo "   creating namespace (op ${OP_ID})..."
  for _ in $(seq 1 30); do
    ST="$(aws servicediscovery get-operation --operation-id "$OP_ID" --region "$AWS_REGION" --query 'Operation.Status' --output text 2>/dev/null || echo PENDING)"
    [ "$ST" = "SUCCESS" ] && break
    [ "$ST" = "FAIL" ] && { echo "!! namespace creation failed" >&2; exit 1; }
    sleep 5
  done
  NS_ARN="$(aws servicediscovery list-namespaces --region "$AWS_REGION" \
    --query "Namespaces[?Name=='${NAMESPACE_NAME}'].Arn | [0]" --output text)"
fi
echo "   ${NS_ARN}"

echo ">> [2/6] Self-ingress on ${SECURITY_GROUP_ID} (intra-task Service Connect traffic)"
aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
  --group-id "$SECURITY_GROUP_ID" --protocol -1 --source-group "$SECURITY_GROUP_ID" \
  >/dev/null 2>&1 || true

echo ">> [3/6] Registering task definitions"
register() {
  local tmpl="$1"; local rendered="${tmpl%.json}.rendered.json"
  envsubst < "$tmpl" > "$rendered"
  aws ecs register-task-definition --cli-input-json "file://${rendered}" \
    --region "$AWS_REGION" --query 'taskDefinition.taskDefinitionArn' --output text
}
BACKEND_TD="$(register "$HERE/task-def-backend.json")";      echo "   $BACKEND_TD"
FRONTEND_TD="$(register "$HERE/task-def-frontend.json")";    echo "   $FRONTEND_TD"
COMBINED_TD="$(register "$HERE/task-def-combined-fe.json")"; echo "   $COMBINED_TD"

svc_active() {
  aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$1" --region "$AWS_REGION" \
    --query 'services[?status==`ACTIVE`].serviceName' --output text 2>/dev/null || true
}

# Service Connect config files.
SC_BACKEND="$(mktemp)"; cat > "$SC_BACKEND" <<JSON
{ "enabled": true, "namespace": "${NS_ARN}",
  "services": [ { "portName": "backend", "clientAliases": [ { "port": 8000, "dnsName": "backend" } ] } ] }
JSON
SC_CLIENT="$(mktemp)"; cat > "$SC_CLIENT" <<JSON
{ "enabled": true, "namespace": "${NS_ARN}" }
JSON

echo ">> [4/6] backend service (internal, Service Connect server)"
if [ -n "$(svc_active pay2play-backend)" ]; then
  aws ecs update-service --cluster "$ECS_CLUSTER" --service pay2play-backend \
    --task-definition "$BACKEND_TD" --network-configuration "$NET_CONFIG" \
    --service-connect-configuration "file://${SC_BACKEND}" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
else
  aws ecs create-service --cluster "$ECS_CLUSTER" --service-name pay2play-backend \
    --task-definition "$BACKEND_TD" --desired-count 1 --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --service-connect-configuration "file://${SC_BACKEND}" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
fi

echo ">> [5/6] combined-fe service (demo)"
if [ -n "$(svc_active pay2play-combined-fe)" ]; then
  aws ecs update-service --cluster "$ECS_CLUSTER" --service pay2play-combined-fe \
    --task-definition "$COMBINED_TD" --network-configuration "$NET_CONFIG" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
else
  aws ecs create-service --cluster "$ECS_CLUSTER" --service-name pay2play-combined-fe \
    --task-definition "$COMBINED_TD" --desired-count 1 --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
fi

echo "   waiting for backend to be reachable before starting frontend..."
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services pay2play-backend --region "$AWS_REGION" || true

# The target group can only be owned by one service, so retire the monolith
# (which currently holds pay2play-tg) before the frontend service claims it.
if [ -n "$(svc_active pay2play)" ] && [ -z "$(svc_active pay2play-frontend)" ]; then
  echo "   retiring monolith service 'pay2play' to free the target group..."
  aws ecs update-service --cluster "$ECS_CLUSTER" --service pay2play --desired-count 0 --region "$AWS_REGION" --query 'service.serviceName' --output text >/dev/null || true
  aws ecs delete-service --cluster "$ECS_CLUSTER" --service pay2play --force --region "$AWS_REGION" --query 'service.serviceName' --output text >/dev/null || true
  aws ecs wait services-inactive --cluster "$ECS_CLUSTER" --services pay2play --region "$AWS_REGION" || true
fi

echo ">> [6/6] frontend service (public via ALB, Service Connect client)"
if [ -n "$(svc_active pay2play-frontend)" ]; then
  aws ecs update-service --cluster "$ECS_CLUSTER" --service pay2play-frontend \
    --task-definition "$FRONTEND_TD" --network-configuration "$NET_CONFIG" \
    --service-connect-configuration "file://${SC_CLIENT}" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
else
  aws ecs create-service --cluster "$ECS_CLUSTER" --service-name pay2play-frontend \
    --task-definition "$FRONTEND_TD" --desired-count 1 --launch-type FARGATE \
    --network-configuration "$NET_CONFIG" \
    --service-connect-configuration "file://${SC_CLIENT}" \
    --load-balancers "targetGroupArn=${TARGET_GROUP_ARN},containerName=frontend,containerPort=80" \
    --health-check-grace-period-seconds "$GRACE_PERIOD" \
    --region "$AWS_REGION" --query 'service.serviceArn' --output text
fi

rm -f "$SC_BACKEND" "$SC_CLIENT"

cat <<EOF

>> Three services created/updated; monolith 'pay2play' retired. Watch rollout:
     aws ecs describe-services --cluster ${ECS_CLUSTER} --services pay2play-frontend pay2play-backend pay2play-combined-fe --region ${AWS_REGION} --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount}' --output table
EOF
