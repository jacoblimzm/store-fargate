# ---------------------------------------------------------------------------
# IAM roles are shared, pre-existing and carry broad managed policies, so they
# are referenced (not managed) to avoid clobbering other workloads that use
# them. Terraform only needs their ARNs for the ECS task definitions.
# ---------------------------------------------------------------------------

data "aws_iam_role" "execution" {
  name = var.execution_role_name
}

data "aws_iam_role" "task" {
  name = var.task_role_name
}
