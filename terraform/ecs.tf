# ---------------------------------------------------------------------------
# ECS cluster, Service Connect namespace, task definitions and services.
#
# Task definitions are managed by Terraform (not imported): the first apply
# registers a new, functionally-identical revision and the services roll to it
# with zero downtime (ALB connection draining). Thereafter a new revision is
# produced only when the rendered definition or image_tag changes.
# ---------------------------------------------------------------------------

locals {
  ecr = {
    "pay2play-backend"     = aws_ecr_repository.backend.repository_url
    "pay2play-frontend"    = aws_ecr_repository.frontend.repository_url
    "pay2play-combined-fe" = aws_ecr_repository.combined_fe.repository_url
    "pay2play-logrouter"   = aws_ecr_repository.logrouter.repository_url
  }

  dd_api_key_arn          = data.aws_secretsmanager_secret.dd_api_key.arn
  database_url_arn        = data.aws_secretsmanager_secret.database_url.arn
  jwt_secret_arn          = data.aws_secretsmanager_secret.jwt_secret.arn
  openai_key_arn          = data.aws_secretsmanager_secret.openai_api_key.arn
  datadog_pg_password_arn = data.aws_secretsmanager_secret.datadog_pg_password.arn
  datadog_app_key_arn     = data.aws_secretsmanager_secret.datadog_app_key.arn

  # Datadog agent sidecar, parameterised by CloudWatch log group.
  dd_agent_container = { for svc in ["backend", "frontend", "combined-fe"] : svc => {
    name      = "datadog-agent"
    image     = "public.ecr.aws/datadog/agent:latest"
    cpu       = 0
    essential = true
    environment = [
      { name = "DD_APM_RECEIVER_SOCKET", value = "/var/run/datadog/apm.socket" },
      { name = "DD_SYSTEM_PROBE_NETWORK_ENABLED", value = "true" },
      { name = "DD_SITE", value = var.dd_site },
      { name = "DD_PROCESS_AGENT_ENABLED", value = "true" },
      { name = "DD_NETWORK_CONFIG_ENABLE_EBPFLESS", value = "true" },
      { name = "ECS_FARGATE", value = "true" },
      { name = "DD_APM_ENABLED", value = "true" },
      { name = "DD_ENV", value = var.dd_env },
      { name = "DD_DOGSTATSD_SOCKET", value = "/var/run/datadog/dsd.socket" },
    ]
    mountPoints = [{ sourceVolume = "dd-sockets", containerPath = "/var/run/datadog" }]
    linuxParameters = {
      capabilities = { add = ["SYS_PTRACE"], drop = [] }
    }
    secrets = [{ name = "DD_API_KEY", valueFrom = local.dd_api_key_arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/pay2play-${svc}"
        awslogs-create-group  = "true"
        awslogs-region        = var.region
        awslogs-stream-prefix = "datadog-agent"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "agent health"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
  } }

  # Firelens log router using the stock AWS image (backend + frontend).
  log_router_stock = { for svc in ["backend", "frontend"] : svc => {
    name      = "log_router"
    image     = "public.ecr.aws/aws-observability/aws-for-fluent-bit:stable"
    cpu       = 0
    essential = true
    user      = "0"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = "/ecs/pay2play-${svc}"
        awslogs-create-group  = "true"
        awslogs-region        = var.region
        awslogs-stream-prefix = "log-router"
      }
    }
    firelensConfiguration = {
      type    = "fluentbit"
      options = { enable-ecs-log-metadata = "true" }
    }
  } }
}

# --- Cluster + Service Connect namespace ------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "${var.project}cluster"
}

resource "aws_service_discovery_http_namespace" "main" {
  name = var.project
}

# --- Task definition: backend -----------------------------------------------
resource "aws_ecs_task_definition" "backend" {
  family                   = "pay2play-backend"
  cpu                      = "1024"
  memory                   = "2048"
  network_mode             = "awsvpc"
  pid_mode                 = "task"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  volume {
    name = "dd-sockets"
  }

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${local.ecr["pay2play-backend"]}:${var.image_tag}"
      cpu       = 0
      essential = true
      portMappings = [{
        containerPort = 8000
        hostPort      = 8000
        protocol      = "tcp"
        name          = "backend"
      }]
      environment = [
        { name = "SEED_ON_START", value = "true" },
        { name = "DD_TRACE_AGENT_URL", value = "unix:///var/run/datadog/apm.socket" },
        { name = "DD_VERSION", value = var.dd_version },
        { name = "DD_RUNTIME_METRICS_ENABLED", value = "true" },
        { name = "DD_PROFILING_ENABLED", value = "true" },
        { name = "DD_SERVICE", value = "pay2play-backend" },
        { name = "DD_LOGS_INJECTION", value = "true" },
        { name = "DD_DOGSTATSD_URL", value = "unix:///var/run/datadog/dsd.socket" },
        { name = "DD_ENV", value = var.dd_env },
        { name = "DD_SITE", value = var.dd_site },
        { name = "DD_LLMOBS_ML_APP", value = var.dd_llmobs_ml_app },
        { name = "OPENAI_MODEL", value = var.openai_model },
        { name = "DD_DBM_PROPAGATION_MODE", value = "full" },
        # AI Guard evaluates OpenAI calls (auto-integration under ddtrace-run).
        { name = "DD_AI_GUARD_ENABLED", value = "true" },
        # App & API Protection (AAP) + Runtime Code Analysis (IAST) — flags the
        # security-demo vulns (e.g. SQLi) at runtime and detects attacks.
        { name = "DD_APPSEC_ENABLED", value = "true" },
        { name = "DD_IAST_ENABLED", value = "true" },
      ]
      mountPoints = [{ sourceVolume = "dd-sockets", containerPath = "/var/run/datadog" }]
      secrets = [
        { name = "DATABASE_URL", valueFrom = local.database_url_arn },
        { name = "JWT_SECRET", valueFrom = local.jwt_secret_arn },
        { name = "OPENAI_API_KEY", valueFrom = local.openai_key_arn },
        # AI Guard needs an API key + an app key (ai_guard_evaluate scope).
        { name = "DD_API_KEY", valueFrom = local.dd_api_key_arn },
        { name = "DD_APP_KEY", valueFrom = local.datadog_app_key_arn },
      ]
      dependsOn = [{ containerName = "datadog-agent", condition = "START" }]
      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name           = "datadog"
          Host           = "http-intake.logs.datadoghq.com"
          TLS            = "on"
          provider       = "ecs"
          dd_message_key = "log"
          dd_service     = "pay2play-backend"
          dd_source      = "python"
          dd_tags        = "env:${var.dd_env}"
        }
        secretOptions = [{ name = "apikey", valueFrom = local.dd_api_key_arn }]
      }
    },
    local.dd_agent_container["backend"],
    local.log_router_stock["backend"],
  ])
}

# --- Task definition: frontend ----------------------------------------------
resource "aws_ecs_task_definition" "frontend" {
  family                   = "pay2play-frontend"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  pid_mode                 = "task"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  volume {
    name = "dd-sockets"
  }

  container_definitions = jsonencode([
    {
      name      = "frontend"
      image     = "${local.ecr["pay2play-frontend"]}:${var.image_tag}"
      cpu       = 0
      essential = true
      portMappings = [{
        containerPort = 80
        hostPort      = 80
        protocol      = "tcp"
      }]
      environment = [
        { name = "BACKEND_PORT", value = "8000" },
        { name = "BACKEND_HOST", value = "backend" },
      ]
      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name           = "datadog"
          Host           = "http-intake.logs.datadoghq.com"
          TLS            = "on"
          provider       = "ecs"
          dd_message_key = "log"
          dd_service     = "pay2play-frontend"
          dd_source      = "nginx"
          dd_tags        = "env:${var.dd_env}"
        }
        secretOptions = [{ name = "apikey", valueFrom = local.dd_api_key_arn }]
      }
    },
    local.dd_agent_container["frontend"],
    local.log_router_stock["frontend"],
  ])
}

# --- Task definition: combined-fe -------------------------------------------
resource "aws_ecs_task_definition" "combined_fe" {
  family                   = "pay2play-combined-fe"
  cpu                      = "512"
  memory                   = "1024"
  network_mode             = "awsvpc"
  pid_mode                 = "task"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  volume {
    name = "dd-sockets"
  }

  container_definitions = jsonencode([
    {
      name      = "combined-fe"
      image     = "${local.ecr["pay2play-combined-fe"]}:${var.image_tag}"
      cpu       = 0
      essential = true
      environment = [
        { name = "DD_SERVICE", value = "pay2play-combined-fe" },
        { name = "DD_LOGS_INJECTION", value = "true" },
        { name = "DD_DOGSTATSD_URL", value = "unix:///var/run/datadog/dsd.socket" },
        { name = "DD_ENV", value = var.dd_env },
        { name = "DD_TRACE_AGENT_URL", value = "unix:///var/run/datadog/apm.socket" },
        { name = "DD_VERSION", value = var.dd_version },
      ]
      mountPoints = [{ sourceVolume = "dd-sockets", containerPath = "/var/run/datadog" }]
      dependsOn   = [{ containerName = "datadog-agent", condition = "START" }]
      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name           = "datadog"
          Host           = "http-intake.logs.datadoghq.com"
          TLS            = "on"
          provider       = "ecs"
          dd_message_key = "log"
          dd_service     = "pay2play-combined-fe"
          dd_source      = "python"
          dd_tags        = "env:${var.dd_env}"
        }
        secretOptions = [{ name = "apikey", valueFrom = local.dd_api_key_arn }]
      }
    },
    local.dd_agent_container["combined-fe"],
    {
      name      = "log_router"
      image     = "${local.ecr["pay2play-logrouter"]}:${var.image_tag}"
      cpu       = 0
      essential = true
      user      = "0"
      environment = [
        { name = "DD_SITE", value = var.dd_site },
        { name = "DD_ENV", value = var.dd_env },
      ]
      secrets = [{ name = "DD_API_KEY", valueFrom = local.dd_api_key_arn }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/pay2play-combined-fe"
          awslogs-create-group  = "true"
          awslogs-region        = var.region
          awslogs-stream-prefix = "log-router"
        }
      }
      firelensConfiguration = {
        type = "fluentbit"
        options = {
          config-file-type        = "file"
          config-file-value       = "/extra.conf"
          enable-ecs-log-metadata = "true"
        }
      }
    },
  ])
}

# --- Services ---------------------------------------------------------------
resource "aws_ecs_service" "backend" {
  name                          = "pay2play-backend"
  cluster                       = aws_ecs_cluster.main.id
  task_definition               = aws_ecs_task_definition.backend.arn
  desired_count                 = 1
  launch_type                   = "FARGATE"
  availability_zone_rebalancing = "ENABLED"

  # Fail fast + auto-rollback on a bad rollout instead of waiting out the
  # pipeline's stabilize timeout.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn

    service {
      port_name      = "backend"
      discovery_name = "backend"
      client_alias {
        port     = 8000
        dns_name = "backend"
      }
    }
  }
}

resource "aws_ecs_service" "frontend" {
  name                              = "pay2play-frontend"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.frontend.arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  availability_zone_rebalancing     = "ENABLED"
  health_check_grace_period_seconds = 30

  # Fail fast + auto-rollback on a bad rollout instead of waiting out the
  # pipeline's stabilize timeout.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "frontend"
    container_port   = 80
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
  }

  depends_on = [aws_lb_listener_rule.app]
}

resource "aws_ecs_service" "combined_fe" {
  name                          = "pay2play-combined-fe"
  cluster                       = aws_ecs_cluster.main.id
  task_definition               = aws_ecs_task_definition.combined_fe.arn
  desired_count                 = 1
  launch_type                   = "FARGATE"
  availability_zone_rebalancing = "ENABLED"

  # Fail fast + auto-rollback on a bad rollout instead of waiting out the
  # pipeline's stabilize timeout.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }
}

# ---------------------------------------------------------------------------
# Dedicated Database Monitoring Agent.
#
# DBM checks poll a *remote* endpoint (RDS), so — unlike APM/logs/CNM which are
# per-workload sidecars — the check must run on exactly ONE Agent, or every app
# replica would poll the same instance and double-count. This standalone,
# single-replica service is the one DBM poller and the home for all current and
# future database checks (add more `instances` / integrations here). It has no
# ALB, no Service Connect, and no APM/DogStatsD sockets — just egress to the DB
# and to Datadog. Reuses the task SG (already permitted into the RDS SG:5432).
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "dbm_agent" {
  family                   = "pay2play-dbm-agent"
  cpu                      = "256"
  memory                   = "512"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = data.aws_iam_role.execution.arn
  task_role_arn            = data.aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "datadog-agent"
      image     = "public.ecr.aws/datadog/agent:latest"
      essential = true
      environment = [
        { name = "DD_SITE", value = var.dd_site },
        { name = "DD_ENV", value = var.dd_env },
        { name = "ECS_FARGATE", value = "true" },
        # DB-monitoring only — no local telemetry to collect here.
        { name = "DD_APM_ENABLED", value = "false" },
        { name = "DD_PROCESS_AGENT_ENABLED", value = "false" },
      ]
      secrets = [
        { name = "DD_API_KEY", valueFrom = local.dd_api_key_arn },
        { name = "DD_PG_PASSWORD", valueFrom = local.datadog_pg_password_arn },
      ]
      # RDS is external (no container to autodiscover) so the Postgres check is
      # defined statically on the Agent container; the password is injected from
      # Secrets Manager via the %%env_...%% Autodiscovery template variable.
      dockerLabels = {
        "com.datadoghq.ad.checks" = jsonencode({
          postgres = {
            init_config = {}
            instances = [{
              dbm                       = true
              host                      = aws_db_instance.main.address
              port                      = 5432
              username                  = "datadog"
              password                  = "%%env_DD_PG_PASSWORD%%"
              dbname                    = "pay2play"
              collect_schemas           = { enabled = true }
              collect_column_statistics = { enabled = true }
              tags = [
                "service:pay2play-db",
                "env:${var.dd_env}",
                "dbinstanceidentifier:${aws_db_instance.main.identifier}",
              ]
            }]
          }
        })
      }
      healthCheck = {
        command     = ["CMD-SHELL", "agent health"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 15
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/pay2play-dbm-agent"
          awslogs-create-group  = "true"
          awslogs-region        = var.region
          awslogs-stream-prefix = "datadog-agent"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "dbm_agent" {
  name            = "pay2play-dbm-agent"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.dbm_agent.arn
  desired_count   = 1 # exactly one DBM poller
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }
}
