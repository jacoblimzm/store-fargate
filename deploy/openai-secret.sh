#!/usr/bin/env bash
# One-time setup for the chatbot add-on: store the OpenAI API key in AWS Secrets
# Manager, record its ARN in deploy.env, and grant the ECS execution role
# permission to read it. Idempotent -- safe to re-run (updates the secret value).
#
# Reads the key from the gitignored ../.env (OPENAI_API_KEY=...). The key is
# never printed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# Load persisted deploy vars (AWS_REGION, EXECUTION_ROLE_NAME, ...).
[ -f "$HERE/deploy.env" ] && . "$HERE/deploy.env"
: "${AWS_REGION:?set AWS_REGION in deploy.env}"
: "${EXECUTION_ROLE_NAME:?set EXECUTION_ROLE_NAME in deploy.env}"

# Pull the key out of .env without echoing it.
OPENAI_API_KEY="$(grep -E '^OPENAI_API_KEY=' "$ROOT/.env" | cut -d= -f2-)"
: "${OPENAI_API_KEY:?OPENAI_API_KEY not found in $ROOT/.env}"

SECRET_NAME="pay2play/openai_api_key"

echo ">> Creating/updating secret ${SECRET_NAME}"
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$SECRET_NAME" \
    --secret-string "$OPENAI_API_KEY" --region "$AWS_REGION" >/dev/null
else
  aws secretsmanager create-secret --name "$SECRET_NAME" \
    --secret-string "$OPENAI_API_KEY" --region "$AWS_REGION" >/dev/null
fi

ARN="$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" \
  --region "$AWS_REGION" --query ARN --output text)"
echo "   ${ARN}"

echo ">> Recording OPENAI_API_KEY_SECRET_ARN in deploy.env"
if grep -q '^OPENAI_API_KEY_SECRET_ARN=' "$HERE/deploy.env"; then
  sed -i.bak "s#^OPENAI_API_KEY_SECRET_ARN=.*#OPENAI_API_KEY_SECRET_ARN=${ARN}#" "$HERE/deploy.env"
  rm -f "$HERE/deploy.env.bak"
else
  printf '\n# Chatbot add-on: OpenAI API key secret (created by openai-secret.sh)\nOPENAI_API_KEY_SECRET_ARN=%s\n' "$ARN" >> "$HERE/deploy.env"
fi

echo ">> Granting ${EXECUTION_ROLE_NAME} read access (inline policy)"
aws iam put-role-policy \
  --role-name "$EXECUTION_ROLE_NAME" \
  --policy-name pay2play-openai-secret \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": \"secretsmanager:GetSecretValue\",
      \"Resource\": \"${ARN}\"
    }]
  }"

echo ">> Done. The OpenAI key is in Secrets Manager and the exec role can read it."
