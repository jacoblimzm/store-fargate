#!/usr/bin/env bash
# Put CloudFront in front of the existing internet-facing ALB so the app stays
# publicly reachable WITHOUT an 0.0.0.0/0 ingress rule on the ALB SG (the account
# auto-revokes 0.0.0.0/0). Mirrors datadog-universe-alb: the ALB SG only trusts
# the CloudFront origin-facing managed prefix list.
#
#   viewer -> CloudFront (edge TLS, alias pay2play.dogdysseus.ai)
#          -> HTTPS:443 -> ALB (host-based rule) -> ECS
#   ALB SG ingress = ONLY the CloudFront prefix list on 443.
#
# Usage:  ./deploy/cloudfront-front.sh
# Idempotent: reuses an existing us-east-1 wildcard cert / distribution / records.
#
# Notes:
#  - App resources live in ap-southeast-1; --region is always passed explicitly.
#  - CloudFront requires its viewer cert in us-east-1.
#  - CloudFront validates the ORIGIN TLS cert against the Origin Domain Name, not
#    the forwarded Host. The ALB presents *.dogdysseus.ai which does NOT cover
#    *.elb.amazonaws.com, so we point the origin at alb-origin.dogdysseus.ai
#    (a single label covered by the wildcard cert) which aliases to the ALB.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/deploy.env" ] && { echo ">> Sourcing $HERE/deploy.env"; . "$HERE/deploy.env"; }

# --- Config (override via env / deploy.env) ---
APP_REGION="${AWS_REGION:-ap-southeast-1}"       # where the ALB/ECS live
CF_CERT_REGION="us-east-1"                        # CloudFront viewer certs must be here
BASE_DOMAIN="${BASE_DOMAIN:-dogdysseus.ai}"
APP_FQDN="${APP_FQDN:-pay2play.${BASE_DOMAIN}}"
ORIGIN_FQDN="${ORIGIN_FQDN:-alb-origin.${BASE_DOMAIN}}"
WILDCARD="*.${BASE_DOMAIN}"
ALB_NAME="${ALB_NAME:-pay2play-alb}"
ALB_SG="${ALB_SG:?set ALB_SG (the ALB security group id)}"
CF_PREFIX_LIST="${CF_PREFIX_LIST:-pl-31a34658}"  # com.amazonaws.global.cloudfront.origin-facing (ap-southeast-1)
CF_ZONE_ID="Z2FDTNDATAQYW2"                       # fixed CloudFront hosted zone id for aliases
# AWS-managed policies:
CACHE_POLICY_DISABLED="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"  # CachingDisabled
ORIGIN_REQ_ALLVIEWER="216adef6-5c7f-47e4-b989-5492eafa07d3"   # Managed-AllViewer
CLIENT_CIDR="116.88.89.199/32"                   # legacy dev ingress to revoke off the ALB SG
CF_COMMENT="pay2play front - CloudFront edge for ${APP_FQDN}"

echo "=================================================================="
echo " CloudFront front for ${APP_FQDN}"
echo "   app region:  ${APP_REGION}"
echo "   origin fqdn: ${ORIGIN_FQDN} -> ALB ${ALB_NAME}"
echo "   ALB SG:      ${ALB_SG}  (lock to ${CF_PREFIX_LIST} on 443)"
echo "=================================================================="

# --- [0/7] Hosted zone + ALB facts ---
echo ">> [0/7] Discovering hosted zone + ALB"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"
if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" = "None" ]; then
  HOSTED_ZONE_ID="$(aws route53 list-hosted-zones-by-name --dns-name "${BASE_DOMAIN}." \
    --query "HostedZones[?Name=='${BASE_DOMAIN}.'].Id | [0]" --output text | sed 's|/hostedzone/||')"
fi
[ -n "$HOSTED_ZONE_ID" ] && [ "$HOSTED_ZONE_ID" != "None" ] || { echo "!! no hosted zone for ${BASE_DOMAIN}" >&2; exit 1; }
echo "   hosted zone: ${HOSTED_ZONE_ID}"

read -r ALB_DNS ALB_ZONE_ID <<<"$(aws elbv2 describe-load-balancers --names "$ALB_NAME" --region "$APP_REGION" \
  --query 'LoadBalancers[0].[DNSName,CanonicalHostedZoneId]' --output text)"
[ -n "$ALB_DNS" ] && [ "$ALB_DNS" != "None" ] || { echo "!! ALB ${ALB_NAME} not found in ${APP_REGION}" >&2; exit 1; }
echo "   ALB DNS:     ${ALB_DNS} (zone ${ALB_ZONE_ID})"

# --- [1/7] ACM wildcard cert in us-east-1 (reuse if ISSUED) ---
echo ">> [1/7] ACM ${WILDCARD} in ${CF_CERT_REGION}"
CF_CERT_ARN="$(aws acm list-certificates --region "$CF_CERT_REGION" \
  --query "CertificateSummaryList[?DomainName=='${WILDCARD}'].CertificateArn | [0]" --output text)"
if [ -z "$CF_CERT_ARN" ] || [ "$CF_CERT_ARN" = "None" ]; then
  CF_CERT_ARN="$(aws acm request-certificate --region "$CF_CERT_REGION" \
    --domain-name "$WILDCARD" \
    --validation-method DNS \
    --idempotency-token "cffront$(echo "$BASE_DOMAIN" | tr -cd 'a-z0-9')" \
    --query CertificateArn --output text)"
  echo "   requested $CF_CERT_ARN"
  sleep 5
else
  echo "   found $CF_CERT_ARN"
fi

# Write DNS validation record(s) into Route 53 (ACM may need a moment to populate them)
for _ in $(seq 1 12); do
  MAPPING="$(aws acm describe-certificate --region "$CF_CERT_REGION" --certificate-arn "$CF_CERT_ARN" \
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
    cb=json.dumps({"Comment":"ACM DNS validation (CloudFront cert)","Changes":batch})
    subprocess.run(["aws","route53","change-resource-record-sets","--hosted-zone-id",os.environ["HZ"],"--change-batch",cb],check=True,stdout=subprocess.DEVNULL)
    print("   upserted %d validation record(s)"%len(batch))
else:
    print("   no validation records to write (already validated?)")
'
echo "   waiting for cert to be ISSUED..."
aws acm wait certificate-validated --region "$CF_CERT_REGION" --certificate-arn "$CF_CERT_ARN"
echo "   ISSUED: ${CF_CERT_ARN}"

# --- [2/7] Origin alias alb-origin.<domain> -> ALB (A + AAAA) ---
echo ">> [2/7] Route 53 alias ${ORIGIN_FQDN} -> ${ALB_DNS}"
CB="$(FQDN="$ORIGIN_FQDN" ZONE="$ALB_ZONE_ID" DNS="$ALB_DNS" python3 -c '
import json,os
fqdn,zone,dns=os.environ["FQDN"],os.environ["ZONE"],os.environ["DNS"]
def rec(t):
    return {"Action":"UPSERT","ResourceRecordSet":{"Name":fqdn,"Type":t,
        "AliasTarget":{"HostedZoneId":zone,"DNSName":dns,"EvaluateTargetHealth":True}}}
print(json.dumps({"Comment":"CloudFront origin alias -> ALB","Changes":[rec("A"),rec("AAAA")]}))
')"
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$CB" --query 'ChangeInfo.Status' --output text

# --- [3/7] CloudFront distribution (create if none has our alias) ---
echo ">> [3/7] CloudFront distribution (alias ${APP_FQDN})"
CF_ID="$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '${APP_FQDN}')].Id | [0]" \
  --output text 2>/dev/null || true)"
if [ -n "$CF_ID" ] && [ "$CF_ID" != "None" ]; then
  echo "   reusing existing distribution ${CF_ID}"
else
  CFG="$HERE/cloudfront-dist-config.json"
  ORIGIN_FQDN="$ORIGIN_FQDN" APP_FQDN="$APP_FQDN" CF_CERT_ARN="$CF_CERT_ARN" \
  CACHE_POLICY_DISABLED="$CACHE_POLICY_DISABLED" ORIGIN_REQ_ALLVIEWER="$ORIGIN_REQ_ALLVIEWER" \
  CF_COMMENT="$CF_COMMENT" CFG_OUT="$CFG" CALLER_REF="pay2play-front-$(date +%s)" python3 -c '
import json,os
cfg={
 "CallerReference":os.environ["CALLER_REF"],
 "Aliases":{"Quantity":1,"Items":[os.environ["APP_FQDN"]]},
 "DefaultRootObject":"",
 "Origins":{"Quantity":1,"Items":[{
    "Id":"alb-origin",
    "DomainName":os.environ["ORIGIN_FQDN"],
    "OriginPath":"",
    "CustomHeaders":{"Quantity":0},
    "CustomOriginConfig":{
       "HTTPPort":80,"HTTPSPort":443,
       "OriginProtocolPolicy":"https-only",
       "OriginSslProtocols":{"Quantity":1,"Items":["TLSv1.2"]},
       "OriginReadTimeout":30,"OriginKeepaliveTimeout":5},
    "ConnectionAttempts":3,"ConnectionTimeout":10,
    "OriginShield":{"Enabled":False}
 }]},
 "OriginGroups":{"Quantity":0},
 "DefaultCacheBehavior":{
    "TargetOriginId":"alb-origin",
    "ViewerProtocolPolicy":"redirect-to-https",
    "AllowedMethods":{"Quantity":7,
       "Items":["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
       "CachedMethods":{"Quantity":2,"Items":["GET","HEAD"]}},
    "Compress":True,
    "SmoothStreaming":False,
    "FieldLevelEncryptionId":"",
    "CachePolicyId":os.environ["CACHE_POLICY_DISABLED"],
    "OriginRequestPolicyId":os.environ["ORIGIN_REQ_ALLVIEWER"],
    "LambdaFunctionAssociations":{"Quantity":0},
    "FunctionAssociations":{"Quantity":0}
 },
 "CacheBehaviors":{"Quantity":0},
 "CustomErrorResponses":{"Quantity":0},
 "Comment":os.environ["CF_COMMENT"],
 "Logging":{"Enabled":False,"IncludeCookies":False,"Bucket":"","Prefix":""},
 "PriceClass":"PriceClass_All",
 "Enabled":True,
 "ViewerCertificate":{
    "ACMCertificateArn":os.environ["CF_CERT_ARN"],
    "SSLSupportMethod":"sni-only",
    "MinimumProtocolVersion":"TLSv1.2_2021",
    "CertificateSource":"acm"},
 "Restrictions":{"GeoRestriction":{"RestrictionType":"none","Quantity":0}},
 "WebACLId":"",
 "HttpVersion":"http2and3",
 "IsIPV6Enabled":True
}
open(os.environ["CFG_OUT"],"w").write(json.dumps(cfg,indent=2))
'
  read -r CF_ID CF_DOMAIN <<<"$(aws cloudfront create-distribution \
    --distribution-config "file://$CFG" \
    --query 'Distribution.[Id,DomainName]' --output text)"
  [ -n "$CF_ID" ] && [ "$CF_ID" != "None" ] || { echo "!! distribution creation failed" >&2; exit 1; }
  echo "   created distribution ${CF_ID} (${CF_DOMAIN})"
fi
CF_DOMAIN="$(aws cloudfront get-distribution --id "$CF_ID" --query 'Distribution.DomainName' --output text)"
echo "   distribution: ${CF_ID}  ${CF_DOMAIN}"

# --- [4/7] Lock the ALB SG to the CloudFront prefix list on 443 ---
echo ">> [4/7] Locking ALB SG ${ALB_SG} -> ${CF_PREFIX_LIST} on 443"
aws ec2 authorize-security-group-ingress --region "$APP_REGION" --group-id "$ALB_SG" \
  --ip-permissions "IpProtocol=tcp,FromPort=443,ToPort=443,PrefixListIds=[{PrefixListId=${CF_PREFIX_LIST},Description=\"HTTPS from CloudFront origin-facing IPs\"}]" \
  >/dev/null 2>&1 && echo "   authorized ${CF_PREFIX_LIST} on 443" \
  || echo "   ${CF_PREFIX_LIST} on 443 already present"
# Revoke legacy single-IP dev ingress (80 + 443). Ignore if already gone.
aws ec2 revoke-security-group-ingress --region "$APP_REGION" --group-id "$ALB_SG" \
  --protocol tcp --port 443 --cidr "$CLIENT_CIDR" >/dev/null 2>&1 && echo "   revoked ${CLIENT_CIDR} on 443" \
  || echo "   ${CLIENT_CIDR} on 443 already absent"
aws ec2 revoke-security-group-ingress --region "$APP_REGION" --group-id "$ALB_SG" \
  --protocol tcp --port 80 --cidr "$CLIENT_CIDR" >/dev/null 2>&1 && echo "   revoked ${CLIENT_CIDR} on 80" \
  || echo "   ${CLIENT_CIDR} on 80 already absent"
echo "   final ALB SG ingress:"
aws ec2 describe-security-groups --region "$APP_REGION" --group-ids "$ALB_SG" \
  --query 'SecurityGroups[0].IpPermissions' --output json

# --- [5/7] Wait for the distribution to finish deploying (15-30 min) ---
echo ">> [5/7] Waiting for distribution ${CF_ID} to deploy (can take 15-30 min)..."
aws cloudfront wait distribution-deployed --id "$CF_ID"
echo "   Deployed."

# --- [6/7] DNS cutover: pay2play -> CloudFront (A + AAAA alias) ---
echo ">> [6/7] DNS cutover ${APP_FQDN} -> ${CF_DOMAIN}"
CB2="$(FQDN="$APP_FQDN" ZONE="$CF_ZONE_ID" DNS="$CF_DOMAIN" python3 -c '
import json,os
fqdn,zone,dns=os.environ["FQDN"],os.environ["ZONE"],os.environ["DNS"]
def rec(t):
    return {"Action":"UPSERT","ResourceRecordSet":{"Name":fqdn,"Type":t,
        "AliasTarget":{"HostedZoneId":zone,"DNSName":dns,"EvaluateTargetHealth":False}}}
print(json.dumps({"Comment":"cutover pay2play -> CloudFront","Changes":[rec("A"),rec("AAAA")]}))
')"
aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$CB2" --query 'ChangeInfo.Status' --output text

# --- [7/7] Verify ---
echo ">> [7/7] Verifying (DNS may lag a few minutes)"
for _ in $(seq 1 10); do
  RES="$(dig +short "$APP_FQDN" | tr '\n' ' ')"
  echo "   dig ${APP_FQDN}: ${RES}"
  echo "$RES" | grep -qi cloudfront && break || true
  # Alias A records resolve to IPs, not the cloudfront name; also check the CNAME chain.
  echo "$RES" | grep -Eq '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' && break || true
  sleep 20
done
echo "   --- curl -sSI https://${APP_FQDN}/ ---"
curl -sSI "https://${APP_FQDN}/" || true
echo "   --- app content check ---"
curl -s "https://${APP_FQDN}/js/app.js" | grep -m1 onReady || echo "   (onReady not found yet - retry after propagation)"

cat <<EOF

>> Done.
   Cert (us-east-1):  ${CF_CERT_ARN}
   Distribution:      ${CF_ID}  ${CF_DOMAIN}
   Origin alias:      ${ORIGIN_FQDN} -> ${ALB_DNS}
   App alias:         ${APP_FQDN} -> ${CF_DOMAIN} (CloudFront)
   ALB SG:            ${ALB_SG} ingress = ${CF_PREFIX_LIST} on 443 only
   URL:               https://${APP_FQDN}/
EOF
