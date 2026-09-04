#!/usr/bin/env bash
# One-time-per-domain landing zone setup on the shared ALB:
#   - Wildcard ACM cert  *.<domain> (+ apex), DNS-validated automatically via Route 53
#   - HTTPS :443 listener on the ALB using that cert (default action: 404 "no app")
#   - HTTP  :80  listener redirects to 443
#   - Opens 443 on the ALB security group
# Persists CERT_ARN / HOSTED_ZONE_ID / HTTPS_LISTENER_ARN / ALB_DNS / ALB_ZONE_ID
# into deploy.env for deploy/app-domain.sh to consume.
#
# Usage:  BASE_DOMAIN=dogdysseus.ai ./deploy/landing-zone.sh
# Idempotent: reuses an existing wildcard cert / listeners when present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/deploy.env" ] && { echo ">> Sourcing $HERE/deploy.env"; . "$HERE/deploy.env"; }

BASE_DOMAIN="${BASE_DOMAIN:-${1:-}}"
: "${BASE_DOMAIN:?set BASE_DOMAIN=example.com}"
: "${AWS_REGION:?}"; : "${ALB_ARN:?}"; : "${ALB_SG:?}"
WILDCARD="*.${BASE_DOMAIN}"

persist() { # key value  -> upsert into deploy.env
  local k="$1" v="$2"
  if grep -q "^${k}=" "$HERE/deploy.env" 2>/dev/null; then
    sed -i.bak "s|^${k}=.*|${k}=${v}|" "$HERE/deploy.env" && rm -f "$HERE/deploy.env.bak"
  else
    printf '%s=%s\n' "$k" "$v" >> "$HERE/deploy.env"
  fi
}

echo ">> [1/7] Hosted zone for ${BASE_DOMAIN}"
HOSTED_ZONE_ID="$(aws route53 list-hosted-zones-by-name --dns-name "${BASE_DOMAIN}." \
  --query "HostedZones[?Name=='${BASE_DOMAIN}.'].Id | [0]" --output text | sed 's|/hostedzone/||')"
[ -n "$HOSTED_ZONE_ID" ] && [ "$HOSTED_ZONE_ID" != "None" ] || { echo "!! no public hosted zone for ${BASE_DOMAIN}" >&2; exit 1; }
echo "   $HOSTED_ZONE_ID"

echo ">> [2/7] Wildcard ACM certificate ${WILDCARD} (region ${AWS_REGION})"
CERT_ARN="$(aws acm list-certificates --region "$AWS_REGION" \
  --query "CertificateSummaryList[?DomainName=='${WILDCARD}'].CertificateArn | [0]" --output text)"
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  CERT_ARN="$(aws acm request-certificate --region "$AWS_REGION" \
    --domain-name "$WILDCARD" --subject-alternative-names "$BASE_DOMAIN" \
    --validation-method DNS --query CertificateArn --output text)"
  echo "   requested $CERT_ARN"
  sleep 5
else
  echo "   reusing $CERT_ARN"
fi

echo ">> [3/7] Writing DNS validation records into Route 53"
# ACM needs a moment to populate ResourceRecord; retry a few times.
for _ in $(seq 1 12); do
  MAPPING="$(aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" \
    --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output json)"
  [ "$(echo "$MAPPING" | tr -d '[:space:]')" != "null" ] && [ "$MAPPING" != "[]" ] && break
  sleep 5
done
echo "$MAPPING" | HZ="$HOSTED_ZONE_ID" python3 -c '
import json,sys,subprocess,os
recs=json.load(sys.stdin) or []
seen=set(); batch=[]
for r in recs:
    key=(r["Name"],r["Value"])
    if key in seen: continue
    seen.add(key)
    batch.append({"Action":"UPSERT","ResourceRecordSet":{"Name":r["Name"],"Type":r["Type"],"TTL":300,"ResourceRecords":[{"Value":r["Value"]}]}})
if batch:
    cb=json.dumps({"Comment":"ACM DNS validation","Changes":batch})
    subprocess.run(["aws","route53","change-resource-record-sets","--hosted-zone-id",os.environ["HZ"],"--change-batch",cb],check=True,stdout=subprocess.DEVNULL)
    print("   upserted %d validation record(s)"%len(batch))
else:
    print("   no validation records to write")
'

echo ">> [4/7] Waiting for certificate to be ISSUED (this can take a few minutes)"
for _ in $(seq 1 40); do
  ST="$(aws acm describe-certificate --region "$AWS_REGION" --certificate-arn "$CERT_ARN" --query 'Certificate.Status' --output text)"
  echo "   status: $ST"
  [ "$ST" = "ISSUED" ] && break
  [ "$ST" = "FAILED" ] && { echo "!! cert validation failed" >&2; exit 1; }
  sleep 15
done

echo ">> [5/7] Opening 443 on ALB security group ${ALB_SG}"
aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
  --group-id "$ALB_SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null 2>&1 || true

echo ">> [6/7] HTTPS :443 listener on the ALB"
HTTPS_LISTENER_ARN="$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" \
  --query "Listeners[?Port==\`443\`].ListenerArn | [0]" --output text)"
if [ -z "$HTTPS_LISTENER_ARN" ] || [ "$HTTPS_LISTENER_ARN" = "None" ]; then
  HTTPS_LISTENER_ARN="$(aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" \
    --protocol HTTPS --port 443 --certificates "CertificateArn=${CERT_ARN}" \
    --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
    --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody="No app configured for this host"}' \
    --query 'Listeners[0].ListenerArn' --output text)"
  echo "   created $HTTPS_LISTENER_ARN"
else
  aws elbv2 add-listener-certificates --listener-arn "$HTTPS_LISTENER_ARN" --region "$AWS_REGION" \
    --certificates "CertificateArn=${CERT_ARN}" >/dev/null 2>&1 || true
  echo "   reusing $HTTPS_LISTENER_ARN"
fi

echo ">> [7/7] HTTP :80 -> HTTPS :443 redirect"
HTTP_LISTENER_ARN="$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --region "$AWS_REGION" \
  --query "Listeners[?Port==\`80\`].ListenerArn | [0]" --output text)"
if [ -n "$HTTP_LISTENER_ARN" ] && [ "$HTTP_LISTENER_ARN" != "None" ]; then
  aws elbv2 modify-listener --listener-arn "$HTTP_LISTENER_ARN" --region "$AWS_REGION" \
    --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' >/dev/null
  echo "   80 now redirects to 443"
fi

ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --region "$AWS_REGION" --query 'LoadBalancers[0].DNSName' --output text)"
ALB_ZONE_ID="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --region "$AWS_REGION" --query 'LoadBalancers[0].CanonicalHostedZoneId' --output text)"

persist BASE_DOMAIN "$BASE_DOMAIN"
persist HOSTED_ZONE_ID "$HOSTED_ZONE_ID"
persist CERT_ARN "$CERT_ARN"
persist HTTPS_LISTENER_ARN "$HTTPS_LISTENER_ARN"
persist ALB_DNS "$ALB_DNS"
persist ALB_ZONE_ID "$ALB_ZONE_ID"

cat <<EOF

>> Landing zone ready for ${BASE_DOMAIN}.
   Cert:     ${CERT_ARN}
   Listener: ${HTTPS_LISTENER_ARN}
   Next, onboard an app to a subdomain:
     ./deploy/app-domain.sh pay2play.${BASE_DOMAIN} ${TARGET_GROUP_ARN:-<frontend-target-group-arn>}
EOF
