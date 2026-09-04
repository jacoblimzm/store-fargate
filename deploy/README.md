# Pay2Play - deployment

Deployment is now **Infrastructure as Code (Terraform)** plus a **GitHub Actions
pipeline**. The old hand-run AWS CLI scripts have been removed; this folder only
keeps the Fluent Bit log-router build context ([`fluent-bit/`](./fluent-bit/)),
which is still an input to the `pay2play-logrouter` image.

- Terraform stack: [`../terraform/`](../terraform/) (see its
  [`README.md`](../terraform/README.md)).
- Pipeline: [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  (build + push images, `terraform apply`, roll ECS) and
  [`../.github/workflows/terraform-plan.yml`](../.github/workflows/terraform-plan.yml)
  (plan on PRs).

## What runs where

One ECS Fargate task per service (`awsvpc` mode). Containers in a task share a
network namespace and talk over Service Connect / `127.0.0.1`.

| Container       | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `frontend`      | nginx SPA, reverse-proxies `/api` to the backend               |
| `backend`       | Flask + gunicorn under `ddtrace-run` (APM), port 8000          |
| `datadog-agent` | APM / DogStatsD / infra metrics / CNM sidecar                  |
| `log_router`    | FireLens (Fluent Bit) -> Datadog logs intake                   |
| `combined-fe`   | POC: single container emitting both nginx + python logs        |

The three services (`pay2play-backend`, `pay2play-frontend`,
`pay2play-combined-fe`) run on the `pay2playcluster` ECS cluster behind a
CloudFront -> ALB path, with Postgres on RDS (`pay2play-db`).

### App <-> Agent over UDS

Per the [ECS Fargate integration docs](https://docs.datadoghq.com/integrations/ecs_fargate/),
the app and agent communicate over a Unix Domain Socket shared via the
`dd-sockets` task volume at `/var/run/datadog`:

- Agent: `DD_APM_RECEIVER_SOCKET=/var/run/datadog/apm.socket`,
  `DD_DOGSTATSD_SOCKET=/var/run/datadog/dsd.socket`, `ECS_FARGATE=true`.
- Backend: `DD_TRACE_AGENT_URL=unix:///var/run/datadog/apm.socket`,
  `DD_DOGSTATSD_URL=unix:///var/run/datadog/dsd.socket`.

`DD_AGENT_HOST` is intentionally NOT set. The local `docker-compose.datadog.yml`
overlay uses the same UDS approach.

### Log source routing (FireLens)

Each app container's `logConfiguration` sets its own `dd_source` (`nginx`,
`python`). The `combined-fe` POC splits one container's mixed nginx + python
logs into separate sources using the custom Fluent Bit config at
[`fluent-bit/extra.conf`](./fluent-bit/extra.conf) (`rewrite_tag` re-tags nginx
lines to a second Datadog output). That is why `log_router` for `combined-fe`
runs the custom `pay2play-logrouter` image built from [`fluent-bit/`](./fluent-bit/);
the `backend`/`frontend` services use the stock `aws-for-fluent-bit` image.

### Cloud Network Monitoring (CNM)

CNM is wired into the task definitions ([`../terraform/ecs.tf`](../terraform/ecs.tf)).
On Fargate the Agent uses the ebpfless tracer:
`DD_SYSTEM_PROBE_NETWORK_ENABLED=true`, `DD_NETWORK_CONFIG_ENABLE_EBPFLESS=true`,
`DD_PROCESS_AGENT_ENABLED=true`, the `SYS_PTRACE` capability, and task-level
`pidMode: task`.

## How to deploy

- **Normal path:** merge to `main`. The `deploy` workflow builds + pushes all
  four images tagged with the commit SHA, runs `terraform apply
  -var="image_tag=<sha>"`, and waits for the ECS services to stabilize.
- **Infra review:** open a PR touching `terraform/**`; the `terraform-plan`
  workflow posts a plan comment.
- **Local / manual:** see [`../terraform/README.md`](../terraform/README.md).

## Follow-ups

- **RDS DBM.** Enable Database Monitoring by creating a `datadog` DB user on
  `pay2play-db` (see [`../db/dbm/init-datadog.sql`](../db/dbm/init-datadog.sql))
  and turning on the Agent Postgres check. Not yet provisioned by Terraform.
- **Fluent Bit config delivery.** `log_router` bakes `fluent-bit/extra.conf`
  into a custom image; the AWS init-image (S3-delivered config) is an
  alternative that decouples config from image rebuilds.
