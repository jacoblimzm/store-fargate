# Pay2Play — ECS Fargate deployment (Datadog)

Deploy the Pay2Play task to **AWS ECS Fargate** using a raw ECS
`task-definition.json` + AWS CLI scripts (no Terraform/CDK). One Fargate task
runs every container; in `awsvpc` mode they share a network namespace and talk
over `127.0.0.1`. This is the single source of truth for the deploy — an
end-to-end, prerequisite-by-prerequisite walkthrough for an **ECS service behind
an Application Load Balancer**, plus verification, teardown, and troubleshooting.

Each step exports the variables the next step consumes, so run them in one shell
session (or persist them to `deploy/deploy.env` — see [step 8](#8-register-task-def--create-the-service)).

> Validated against the Datadog [ECS Fargate integration docs](https://docs.datadoghq.com/integrations/ecs_fargate/?tab=awscli),
> the Datadog TS KB *Setting up an ECS Fargate cluster*, and the `aws-samples`
> FireLens examples.

## Containers

| Container       | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `frontend`      | nginx SPA, reverse-proxies `/api` to `127.0.0.1:8000`          |
| `backend`       | Flask + gunicorn under `ddtrace-run` (APM), port 8000          |
| `db`            | Postgres 16 (ephemeral — see [Notes](#notes--follow-ups))      |
| `datadog-agent` | APM / DogStatsD / infra metrics / CNM sidecar                  |
| `log_router`    | FireLens (Fluent Bit) → Datadog logs intake                    |
| `combined-fe`   | *Optional POC:* single container emitting both nginx + python logs, split by source (non-essential) |

### How the backend talks to the Agent (UDS, per Datadog docs)

Following the [ECS Fargate integration docs](https://docs.datadoghq.com/integrations/ecs_fargate/),
the app and agent communicate over a **Unix Domain Socket** shared through the
`dd-sockets` task volume mounted at `/var/run/datadog`:

- Agent: `DD_APM_RECEIVER_SOCKET=/var/run/datadog/apm.socket`,
  `DD_DOGSTATSD_SOCKET=/var/run/datadog/dsd.socket`, `ECS_FARGATE=true`.
- Backend: `DD_TRACE_AGENT_URL=unix:///var/run/datadog/apm.socket`,
  `DD_DOGSTATSD_URL=unix:///var/run/datadog/dsd.socket`.

Importantly, **`DD_AGENT_HOST` is intentionally NOT set** — the docs call this
out explicitly ("do not set `DD_AGENT_HOST`"). `entrypoint.sh` still enables
`ddtrace-run` because it also detects `DD_TRACE_AGENT_URL`.

The local `docker-compose.datadog.yml` overlay uses the same UDS approach (a
`dd-sockets` named volume shared between the agent and backend), per the
[Datadog Docker APM docs](https://docs.datadoghq.com/containers/docker/apm/?tab=linux#unix-domain-socket-uds).

### Log source routing (FireLens)

Each app container's `logConfiguration` sets its own `dd_source` (`nginx`,
`python`, `postgresql`). The `combined-fe` POC additionally demonstrates
splitting **one** container's mixed nginx + python logs into separate sources:
the custom Fluent Bit config at [`fluent-bit/extra.conf`](./fluent-bit/extra.conf)
uses `rewrite_tag` to re-tag nginx lines and ship them to a second Datadog
output with `dd_source:nginx`, while the JSON app logs stay on the
auto-generated `dd_source:python` output. This is why `log_router` runs a custom
image (`pay2play-logrouter`, built from [`fluent-bit/`](./fluent-bit/)) rather
than the stock aws-for-fluent-bit image.

---

## Prerequisites (don't skip)

### Tools / access
- [ ] AWS CLI v2 installed and authenticated (`aws sts get-caller-identity` works).
- [ ] Docker running locally (images are built + pushed from your machine).
- [ ] IAM permissions to create: ECR repos, ECS cluster/service, IAM roles,
      Secrets Manager secrets, EC2 security groups, and an ELBv2 load balancer.
- [ ] A **Datadog API key** for the org/site you'll send data to.

### AWS facts you need up front
- [ ] **Region** (`AWS_REGION`) — must be consistent across every step.
- [ ] A **VPC with two public subnets in different AZs** (default VPC is fine).
      The ALB requires ≥2 AZs.

### Resources this walkthrough CREATES (nothing needs to pre-exist)
- [ ] 3 Secrets Manager secrets: Datadog API key, Postgres password, JWT secret.
- [ ] 2 IAM roles: `ecsTaskExecutionRole` (+ inline: read those secrets,
      `logs:CreateLogGroup`) and `pay2playTaskRole` (minimal).
- [ ] 2 security groups: `pay2play-alb-sg` (in 80 from your IP) and
      `pay2play-task-sg` (in 80 from ALB SG only).
- [ ] 1 ECS cluster: `pay2playcluster`.
- [ ] 1 ALB + target group (`target-type ip`) + HTTP:80 listener.
- [ ] 4 ECR repos (`pay2play-frontend`, `pay2play-backend`,
      `pay2play-combined-fe`, `pay2play-logrouter`) — created by `ecr-push.sh`.

### Key constraints / decisions (read before running)
- **`--desired-count` MUST be `1`.** Postgres runs *inside* the task, so 2+
  replicas would each get their own separately-seeded DB behind one ALB.
  Externalize to RDS before scaling out.
- **DBM is intentionally OFF.** The stock `postgres:16` image has no `datadog`
  DB user. APM, logs, and infra metrics all work; the DB seeds on startup so
  the app is fully functional. See [Notes](#notes--follow-ups) to enable DBM later.
- **`ECS_FARGATE=true`** on the agent is required for `ecs.fargate.*` /
  `container.*` metrics — already set in `task-definition.json`.
- **Do NOT set `DD_AGENT_HOST`** — APM/DogStatsD use the UDS in the shared
  `dd-sockets` volume (already configured).
- **Datadog sandbox only:** if deploying in `tse-sandbox`, add ownership tags
  (`team:technical-support-engineering`, `user:<firstname.lastname>`) to the
  cluster/service via `--tags`.

---

## Deploy paths

Two paths share `ecr-push.sh` for images and `task-definition.json` for the task:

| Path | Script | Endpoint | Use when |
| ---- | ------ | -------- | -------- |
| ALB service (recommended) | `deploy-service.sh` | Stable ALB DNS + health checks | You want a durable URL |
| One-off public-IP task    | `deploy.sh`         | Task's ephemeral public IP     | Quick throwaway test |

Both render `task-definition.json` (placeholders via `envsubst`) into
`task-definition.rendered.json` and register it. The full walkthrough below
covers the **ALB service** path; for a throwaway task, run `deploy.sh` after
steps 1–7 and open `http://<task-public-ip>/` once it's healthy.

---

## 1. Base variables
```bash
export AWS_REGION=ap-southeast-1            # <- your region (Singapore)
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "account=$AWS_ACCOUNT_ID region=$AWS_REGION"
```

## 2. Secrets (Secrets Manager)
The DB password secret feeds both the `db` container (`POSTGRES_PASSWORD`) and
the backend, so they stay in sync.

The Datadog API key secret already exists (created via the console), so just
reference its ARN instead of creating a new one:
```bash
export DD_API_KEY_SECRET_ARN="arn:aws:secretsmanager:ap-southeast-1:<ACCOUNT_ID>:secret:<your-dd-api-key-secret>"
```
> The secret must live in the **same region** you're deploying to
> (`ap-southeast-1`) — Secrets Manager ARNs are region-scoped and the task's
> execution role fetches them at container start. If yours is in another
> region, replicate it or recreate it in `ap-southeast-1`.

Then create the remaining two secrets:
```bash
export DB_PASSWORD_SECRET_ARN=$(aws secretsmanager create-secret \
  --name pay2play/db-password --secret-string "$(openssl rand -base64 24 | tr -d '/+=')" \
  --region $AWS_REGION --query ARN --output text)

export JWT_SECRET_ARN=$(aws secretsmanager create-secret \
  --name pay2play/jwt-secret --secret-string "$(openssl rand -hex 32)" \
  --region $AWS_REGION --query ARN --output text)
```

## 3. IAM roles

Role/policy names are customizable — set a prefix (e.g. `jake-`) once here and
the deploy scripts pick up the same names when rendering the task def. Keep
these exports in the same shell so steps 3 and 8 agree.
```bash
# Customize freely. The deploy scripts default to the un-prefixed names below,
# so if you change them here, export the SAME values before running step 8:
export EXECUTION_ROLE_NAME=jake-ecsTaskExecutionRole
export TASK_ROLE_NAME=jake-pay2playTaskRole
export EXEC_POLICY_NAME=jake-pay2play-exec-extra

cat > /tmp/ecs-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF

aws iam create-role --role-name "$EXECUTION_ROLE_NAME" --assume-role-policy-document file:///tmp/ecs-trust.json
aws iam attach-role-policy --role-name "$EXECUTION_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

cat > /tmp/exec-extra.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],
  "Resource":["$DD_API_KEY_SECRET_ARN","$DB_PASSWORD_SECRET_ARN","$JWT_SECRET_ARN"]},
 {"Effect":"Allow","Action":["logs:CreateLogGroup"],"Resource":"*"}
]}
EOF
aws iam put-role-policy --role-name "$EXECUTION_ROLE_NAME" \
  --policy-name "$EXEC_POLICY_NAME" --policy-document file:///tmp/exec-extra.json

aws iam create-role --role-name "$TASK_ROLE_NAME" --assume-role-policy-document file:///tmp/ecs-trust.json
```
`logs:CreateLogGroup` is needed because the task def sets
`awslogs-create-group: "true"` for the agent/log_router streams and the
AWS-managed policy omits that action.

> **Name consistency matters.** `task-definition.json` references the roles as
> `role/${EXECUTION_ROLE_NAME}` and `role/${TASK_ROLE_NAME}`. The deploy scripts
> default both to the un-prefixed names, so if you prefix them, `export
> EXECUTION_ROLE_NAME` / `TASK_ROLE_NAME` in the same shell before step 8 (the
> `EXEC_POLICY_NAME` is only used here in step 3). Prefixing also sidesteps
> collisions with an account-wide `ecsTaskExecutionRole` that may already exist.

## 4. Networking (default VPC + two SGs)
```bash
export VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text --region $AWS_REGION)

# Pick one public subnet per AZ (the ALB requires subnets in DIFFERENT AZs).
read -r SUBNET_A SUBNET_B _ <<< "$(aws ec2 describe-subnets \
  --filters Name=vpc-id,Values=$VPC_ID Name=map-public-ip-on-launch,Values=true \
  --query 'Subnets[].[AvailabilityZone,SubnetId]' --output text --region $AWS_REGION \
  | sort -u -k1,1 | awk '{print $2}' | tr '\n' ' ')"
echo "vpc=$VPC_ID subnets=$SUBNET_A,$SUBNET_B"
# If SUBNET_B is empty, you lack a 2nd public subnet in a 2nd AZ — create one
# before the ALB step. If you see "cannot be attached to multiple subnets in the
# same Availability Zone", your two subnets share an AZ; the sort -u above fixes it.

export ALB_SG=$(aws ec2 create-security-group --group-name pay2play-alb-sg \
  --description "pay2play ALB" --vpc-id $VPC_ID --query GroupId --output text --region $AWS_REGION)
# Allow inbound 80 from YOUR IP only (a /32). In the Datadog sandbox, security
# tooling auto-revokes broadly-permissive rules like 0.0.0.0/0, which leaves the
# ALB unreachable (targets stay healthy, but clients get a connection timeout).
MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
  --protocol tcp --port 80 --cidr ${MY_IP}/32 --region $AWS_REGION
echo "ALB open to ${MY_IP}/32"

export TASK_SG=$(aws ec2 create-security-group --group-name pay2play-task-sg \
  --description "pay2play tasks" --vpc-id $VPC_ID --query GroupId --output text --region $AWS_REGION)
aws ec2 authorize-security-group-ingress --group-id $TASK_SG \
  --protocol tcp --port 80 --source-group $ALB_SG --region $AWS_REGION
```
> **Sandbox note / dynamic IPs.** If the app becomes unreachable later (IP
> changed, or a `0.0.0.0/0` rule got auto-revoked), re-add your current IP:
> ```bash
> MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
> aws ec2 authorize-security-group-ingress --group-id $ALB_SG \
>   --protocol tcp --port 80 --cidr ${MY_IP}/32 --region $AWS_REGION
> ```
> Outside a locked-down sandbox you can instead use `--cidr 0.0.0.0/0` for a
> publicly reachable demo.

## 5. ECS cluster
```bash
aws ecs create-cluster --cluster-name pay2playcluster --region $AWS_REGION
export ECS_CLUSTER=pay2playcluster
```

## 6. ALB + target group + listener
```bash
export ALB_ARN=$(aws elbv2 create-load-balancer --name pay2play-alb \
  --type application --scheme internet-facing \
  --subnets $SUBNET_A $SUBNET_B --security-groups $ALB_SG \
  --region $AWS_REGION --query 'LoadBalancers[0].LoadBalancerArn' --output text)

export TG_ARN=$(aws elbv2 create-target-group --name pay2play-tg \
  --protocol HTTP --port 80 --vpc-id $VPC_ID --target-type ip \
  --health-check-path / --matcher HttpCode=200-399 \
  --region $AWS_REGION --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 create-listener --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN --region $AWS_REGION
```
Health check hits the `frontend` nginx on `/` (SPA liveness). Switch to
`--health-check-path /api/health` if you want the ALB to gate on the full
frontend→backend→DB chain.

## 7. Build & push images
Builds and pushes all four images (`frontend`, `backend`, `combined-fe`,
`logrouter`), creating the ECR repos if needed:
```bash
./deploy/ecr-push.sh      # uses AWS_ACCOUNT_ID + AWS_REGION
```

## 8. Register task def + create the service
`deploy-service.sh` renders via `envsubst`, registers a new revision, then
creates or updates the ALB service:
```bash
export IMAGE_TAG=latest DD_SITE=datadoghq.com DD_ENV=production
export SUBNETS="$SUBNET_A,$SUBNET_B"
export SECURITY_GROUP_ID=$TASK_SG
export TARGET_GROUP_ARN=$TG_ARN
# If you prefixed the roles in step 3, the exports still live in this shell.
# In a fresh shell, re-export them so the rendered task def points at them:
#   export EXECUTION_ROLE_NAME=jake-ecsTaskExecutionRole TASK_ROLE_NAME=jake-pay2playTaskRole
./deploy/deploy-service.sh
```

### Persist your variables (so you don't re-export every shell)
The deploy scripts **auto-source `deploy/deploy.env`** if it exists. Save your
values there once and future deploys need no exports:
```bash
cp deploy/deploy.env.example deploy/deploy.env
# edit deploy/deploy.env with the real ARNs / ids you captured above
```
`deploy/deploy.env` is gitignored (it holds the account id + secret ARNs). After
that, redeploying an updated task definition from any new shell is just:
```bash
./deploy/ecr-push.sh          # only if the images changed
./deploy/deploy-service.sh    # registers a new revision + updates the service
```

## 9. Verify
```bash
export ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN \
  --query 'LoadBalancers[0].DNSName' --output text --region $AWS_REGION)
echo "App URL: http://$ALB_DNS/"

# wait for "healthy"
aws elbv2 describe-target-health --target-group-arn $TG_ARN --region $AWS_REGION \
  --query 'TargetHealthDescriptions[].TargetHealth.State'

curl -s -o /dev/null -w "%{http_code}\n" "http://$ALB_DNS/api/health"
```
Then log in at `http://$ALB_DNS/` as `ada@pay2play.test` / `Password123!`.

In Datadog, confirm:
- **APM:** service `pay2play-backend` with traces.
- **Logs:** `dd_source` `python` / `nginx` / `postgresql`, backend logs carry
  `dd.trace_id` / `dd.span_id`. (If running the `combined-fe` POC, confirm the
  same container yields both `source:nginx` and `source:python`.)
- **Metrics:** `ecs.fargate.*` and `container.*`, tagged `task_family`,
  `task_version`, `task_arn`, `short_image`, etc. (No `system.*`/`docker.*` on
  Fargate — expected.)
- **Cloud Network Monitoring:** the task shows up on the [CNM page](https://app.datadoghq.com/network)
  with flows between `pay2play-frontend` ↔ `pay2play-backend` ↔ `pay2play-db`
  (see the CNM section below).

---

## Cloud Network Monitoring (CNM)
CNM is already wired into `task-definition.json`. On Fargate the Agent can't use
eBPF, so it runs the **ebpfless** tracer (ptrace-based). The config:
- **Agent env:** `DD_SYSTEM_PROBE_NETWORK_ENABLED=true`,
  `DD_NETWORK_CONFIG_ENABLE_EBPFLESS=true`, `DD_PROCESS_AGENT_ENABLED=true`.
- **Agent capability:** `linuxParameters.capabilities.add: ["SYS_PTRACE"]`.
- **Task-level `pidMode: "task"`** — shares the PID namespace so the Agent can
  ptrace the sibling app containers and see their connections (without it CNM
  only sees the Agent's own traffic).

Requires Agent `7.58+` (we pin `agent:latest`). ECS Fargate CNM is in Preview —
if flows don't appear, confirm your org is enabled for it with your Datadog rep.
No IAM/SG changes are needed; redeploy is just the normal flow:
```bash
./deploy/deploy-service.sh   # registers the new revision + updates the service
```
Verify in [CNM Analytics](https://app.datadoghq.com/network), filtered by
`task_name:pay2play*` or `env:$DD_ENV`. Give it a few minutes after tasks are
`RUNNING` and some traffic has flowed.

**Local Docker** uses the real eBPF tracer instead (kernel supports it). The
`docker-compose.datadog.yml` overlay adds `DD_SYSTEM_PROBE_NETWORK_ENABLED=true`,
the `/sys/kernel/debug` mount, the CNM `cap_add` list, and
`apparmor:unconfined`. Verify with:
```bash
docker exec store-fargate-datadog-agent-1 \
  sh -c 'tail -n 30 /var/log/datadog/system-probe.log'
# look for "module network_tracer started" + "retrieved N connections"
```

---

## Teardown (stop billing)
```bash
aws ecs update-service --cluster $ECS_CLUSTER --service pay2play --desired-count 0 --region $AWS_REGION
aws ecs delete-service --cluster $ECS_CLUSTER --service pay2play --force --region $AWS_REGION
aws elbv2 delete-listener --listener-arn $(aws elbv2 describe-listeners \
  --load-balancer-arn $ALB_ARN --query 'Listeners[0].ListenerArn' --output text --region $AWS_REGION) --region $AWS_REGION
aws elbv2 delete-load-balancer --load-balancer-arn $ALB_ARN --region $AWS_REGION
aws elbv2 delete-target-group --target-group-arn $TG_ARN --region $AWS_REGION
aws ecs delete-cluster --cluster $ECS_CLUSTER --region $AWS_REGION
# then, if you want a full clean slate:
#  - delete SGs pay2play-task-sg + pay2play-alb-sg
#  - delete the 3 secrets (aws secretsmanager delete-secret --force-delete-without-recovery)
#  - delete roles $EXECUTION_ROLE_NAME + $TASK_ROLE_NAME (delete-role-policy $EXEC_POLICY_NAME + detach managed policy first)
#  - delete ECR repos pay2play-frontend, pay2play-backend, pay2play-combined-fe, pay2play-logrouter
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Task stuck in `PROVISIONING`/`STOPPED` | Can't pull image / read secret | Check `ecsTaskExecutionRole` has ECR + `secretsmanager:GetSecretValue` on your ARNs |
| Log group error on start | Missing `logs:CreateLogGroup` | Add it to the exec role inline policy (step 3) |
| `EssentialContainerExited` / backend exits 1 | Two containers bind the same port (shared task network namespace) | Keep container ports unique; e.g. `combined-fe` gunicorn is on 8001 to avoid the backend's 8000 |
| Target `unhealthy` | App still seeding, or wrong path/port | Raise `--health-check-grace-period-seconds`; confirm TG port 80 → `frontend` |
| Can't reach ALB DNS (targets healthy) | ALB SG has no ingress for your IP (sandbox auto-revoked `0.0.0.0/0`) | Add `--cidr <your-ip>/32` to the ALB SG (see step 4 note); confirm listener 80→TG and task SG in 80 from ALB SG |
| No traces/logs in Datadog | Wrong `DD_SITE` / key | Ensure `DD_SITE` matches the API key's org site |
| No `ecs.fargate.*` metrics | `ECS_FARGATE` not set | Must be `"true"` on the agent container |
| No CNM flows on Fargate | Missing `pidMode`/`SYS_PTRACE`, or org not in Preview | Confirm task-level `pidMode:"task"` + agent `SYS_PTRACE` cap + the 3 CNM env vars; ask your Datadog rep to enable Fargate CNM |
| No CNM flows locally | system-probe didn't load eBPF | `tail /var/log/datadog/system-probe.log`; ensure `/sys/kernel/debug` mount, `cap_add`, and `apparmor:unconfined` are present |

---

## Notes & follow-ups

- **Ephemeral database.** The `db` container uses task-local storage; data is
  lost when the task stops. For anything durable, run **Amazon RDS for
  Postgres** and point `POSTGRES_HOST` at the RDS endpoint (then drop the `db`
  container).
- **Keep `DESIRED_COUNT=1`** (the default). Postgres runs inside the task, so
  multiple replicas would each get their own separately-seeded database behind
  one ALB. Externalize to RDS before scaling out.
- **DBM requires a `datadog` DB user.** The stock `postgres:16` image here has
  no `datadog` user, so the agent's Postgres check won't authenticate as-is.
  To enable DBM in-task, bake a custom Postgres image that bundles
  [`../db/dbm/init-datadog.sql`](../db/dbm/init-datadog.sql) in
  `/docker-entrypoint-initdb.d/`, or (better) enable DBM on RDS.
- **Fluent Bit config delivery.** `log_router` bakes `fluent-bit/extra.conf`
  into a custom image. The AWS-recommended alternative on Fargate is the Fluent
  Bit **init image** (`init-latest`) pulling the `.conf` from S3 via
  `aws_fluent_bit_init_s3_*` env vars — this decouples config changes from image
  rebuilds (note: `config-file-type: s3` is *not* supported on Fargate).
