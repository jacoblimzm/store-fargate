#!/usr/bin/env bash
# Onboard one app to a subdomain on the shared landing-zone ALB:
#   - Adds a host-based routing rule on the HTTPS :443 listener:
#       Host == <fqdn>  ->  forward to <target-group>
#   - Creates/updates a Route 53 alias (A + AAAA) <fqdn> -> the ALB
#
# Usage:  ./deploy/app-domain.sh pay2play.dogdysseus.ai <target-group-arn>
# Requires landing-zone.sh to have run first (populates deploy.env).
# Idempotent: updates the existing rule/records if they already exist.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/deploy.env" ] && . "$HERE/deploy.env"

FQDN="${1:?usage: app-domain.sh <fqdn> <target-group-arn>}"
TG_ARN_IN="${2:?usage: app-domain.sh <fqdn> <target-group-arn>}"
: "${AWS_REGION:?}"; : "${HTTPS_LISTENER_ARN:?run landing-zone.sh first}"
: "${HOSTED_ZONE_ID:?run landing-zone.sh first}"; : "${ALB_DNS:?}"; : "${ALB_ZONE_ID:?}"

echo ">> [1/2] Host rule on :443  ${FQDN} -> target group"
EXISTING_RULE="$(aws elbv2 describe-rules --listener-arn "$HTTPS_LISTENER_ARN" --region "$AWS_REGION" \
  --query "Rules[?Conditions[?Field=='host-header' && contains(Values, '${FQDN}')]].RuleArn | [0]" --output text)"
if [ -n "$EXISTING_RULE" ] && [ "$EXISTING_RULE" != "None" ]; then
  aws elbv2 modify-rule --rule-arn "$EXISTING_RULE" --region "$AWS_REGION" \
    --actions "Type=forward,TargetGroupArn=${TG_ARN_IN}" \
    --conditions "Field=host-header,HostHeaderConfig={Values=[${FQDN}]}" >/dev/null
  echo "   updated existing rule"
else
  # pick the lowest free priority (1..50000)
  USED="$(aws elbv2 describe-rules --listener-arn "$HTTPS_LISTENER_ARN" --region "$AWS_REGION" \
    --query "Rules[?Priority!='default'].Priority" --output text)"
  PRIO=1; for p in $USED; do [ "$p" -ge "$PRIO" ] && PRIO=$((p+1)); done
  aws elbv2 create-rule --listener-arn "$HTTPS_LISTENER_ARN" --region "$AWS_REGION" \
    --priority "$PRIO" \
    --conditions "Field=host-header,HostHeaderConfig={Values=[${FQDN}]}" \
    --actions "Type=forward,TargetGroupArn=${TG_ARN_IN}" \
    --query 'Rules[0].RuleArn' --output text >/dev/null
  echo "   created rule at priority ${PRIO}"
fi

echo ">> [2/2] Route 53 alias  ${FQDN} -> ${ALB_DNS}"
CB="$(python3 - "$FQDN" "$ALB_ZONE_ID" "$ALB_DNS" <<'PY'
import json,sys
fqdn,zone,dns=sys.argv[1],sys.argv[2],sys.argv[3]
def rec(t):
    return {"Action":"UPSERT","ResourceRecordSet":{
        "Name":fqdn,"Type":t,
        "AliasTarget":{"HostedZoneId":zone,"DNSName":dns,"EvaluateTargetHealth":True}}}
print(json.dumps({"Comment":"app alias","Changes":[rec("A"),rec("AAAA")]}))
PY
)"
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$CB" --query 'ChangeInfo.Status' --output text

cat <<EOF

>> ${FQDN} is wired up.
   https://${FQDN}  (allow a minute for DNS + the alias to propagate)
EOF
