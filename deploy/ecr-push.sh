#!/usr/bin/env bash
# Build the frontend + backend images and push them to ECR.
#
# Required env:
#   AWS_ACCOUNT_ID   e.g. 123456789012
#   AWS_REGION       e.g. us-east-1
# Optional:
#   IMAGE_TAG        defaults to "latest"
set -euo pipefail

# Auto-load persisted deploy vars so you don't re-export in every shell.
_ENV_FILE="$(cd "$(dirname "$0")" && pwd)/deploy.env"
[ -f "$_ENV_FILE" ] && { echo ">> Sourcing $_ENV_FILE"; . "$_ENV_FILE"; }

: "${AWS_ACCOUNT_ID:?set AWS_ACCOUNT_ID}"
: "${AWS_REGION:?set AWS_REGION}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">> Ensuring ECR repositories exist"
for repo in pay2play-frontend pay2play-backend pay2play-combined-fe pay2play-logrouter; do
  aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$repo" --region "$AWS_REGION" >/dev/null
done

echo ">> Logging in to ECR ($REGISTRY)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

# Fargate runs linux/amd64. Build for that platform explicitly.
echo ">> Building and pushing backend"
docker build --platform linux/amd64 -t "${REGISTRY}/pay2play-backend:${IMAGE_TAG}" "${ROOT}/backend"
docker push "${REGISTRY}/pay2play-backend:${IMAGE_TAG}"

echo ">> Building and pushing frontend"
docker build --platform linux/amd64 -t "${REGISTRY}/pay2play-frontend:${IMAGE_TAG}" "${ROOT}/frontend"
docker push "${REGISTRY}/pay2play-frontend:${IMAGE_TAG}"

# Combined nginx+python container that reproduces the "two log formats, one
# dd_source" scenario (POC for the FireLens source-split).
echo ">> Building and pushing combined-fe"
docker build --platform linux/amd64 -t "${REGISTRY}/pay2play-combined-fe:${IMAGE_TAG}" "${ROOT}/combined-fe"
docker push "${REGISTRY}/pay2play-combined-fe:${IMAGE_TAG}"

# Custom FireLens log router (stock aws-for-fluent-bit + extra.conf) that splits
# combined-fe logs into source:nginx vs source:python.
echo ">> Building and pushing logrouter"
docker build --platform linux/amd64 -t "${REGISTRY}/pay2play-logrouter:${IMAGE_TAG}" "${ROOT}/deploy/fluent-bit"
docker push "${REGISTRY}/pay2play-logrouter:${IMAGE_TAG}"

echo ">> Done. Pushed tag: ${IMAGE_TAG}"
