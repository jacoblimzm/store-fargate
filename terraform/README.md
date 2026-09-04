# Pay2Play - Terraform stack

Infrastructure as Code for the Pay2Play app on AWS (region `ap-southeast-1`,
account `369042512949`). This replaced the hand-run deploy scripts.

## Layout

Flat, single-environment layout - one file per concern:

| File | Contents |
| ---- | -------- |
| `versions.tf` | Terraform + AWS provider pins; `us_east_1` aliased provider (CloudFront cert) |
| `backend.tf` | S3 remote state + DynamoDB lock |
| `variables.tf` / `terraform.tfvars` | Non-secret configuration |
| `network.tf` | VPC/subnets (data), 3 managed security groups |
| `iam.tf` | Execution + task roles (data - referenced, not managed) |
| `secrets.tf` | Secrets Manager lookups (ARNs only, values never in state) |
| `ecr.tf` | 4 ECR repositories |
| `rds.tf` | RDS Postgres instance, subnet group, parameter group |
| `alb.tf` | ALB, target group, HTTP->HTTPS redirect, HTTPS listener + host rule |
| `acm.tf` | ACM certs (data - one per region) |
| `cloudfront.tf` | CloudFront distribution |
| `dns.tf` | Route 53 alias records |
| `ecs.tf` | Cluster, Service Connect namespace, task definitions, services |
| `imports.tf` | `import {}` blocks used to adopt the pre-existing resources |
| `outputs.tf` | Handy outputs (ALB DNS, CloudFront domain, ECR URLs, RDS endpoint) |
| `bootstrap/` | Separate root (local state) - creates the state bucket, lock table and GitHub Actions OIDC role |

## Conventions

- **Secret values never enter Terraform.** Secrets are referenced by ARN via
  data sources; ECS resolves them at container start via the execution role.
- **Shared infra is referenced, app infra is managed.** The VPC/subnets, IAM
  roles and ACM certs are data sources; SGs, ALB, RDS, ECR, CloudFront, Route 53
  records and ECS are managed.
- **Task definitions are managed but not imported.** Terraform registers new
  revisions; the pipeline sets `image_tag` to the commit SHA.
- **`imports.tf` is transitional.** The resources are already in state; the
  blocks are idempotent and can be deleted once you no longer need the adoption
  record.

## Remote state

State lives in `s3://pay2play-tfstate-369042512949/pay2play/app.tfstate` with
locking in the `pay2play-tf-locks` DynamoDB table. These are created by the
`bootstrap/` root (run once).

## Local usage

Terraform's AWS provider needs standard credentials. If you authenticate via
AWS SSO, export them into the environment first:

```bash
cd terraform
eval "$(aws configure export-credentials --format env)"
terraform init
terraform plan     # expect "No changes"
```

To bump images locally instead of via CI:

```bash
terraform apply -var="image_tag=<tag-you-pushed-to-ecr>"
```

## Pipeline

- `../.github/workflows/deploy.yml` - on push to `main`: build+push images (SHA
  tag), `terraform apply -var image_tag=<sha>`, wait for ECS stable.
- `../.github/workflows/terraform-plan.yml` - on PRs touching `terraform/**`:
  `fmt`/`validate`/`plan` with a PR comment.

Both authenticate to AWS via the GitHub OIDC role
`arn:aws:iam::369042512949:role/github-actions-pay2play-deploy` (created in
`bootstrap/`). No long-lived AWS keys are stored in GitHub.

## Bootstrap (one-time)

```bash
cd terraform/bootstrap
eval "$(aws configure export-credentials --format env)"
terraform init
terraform apply
```
