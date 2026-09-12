"""GET /api/status — live runtime view of the backend Datadog surface.

Status is derived from the container's *runtime* environment plus an actual
reachability probe of the Datadog Agent (APM/DogStatsD sockets) — not build
config. Each product returns on/off/error + a human reason for the Status page.
"""

import os
import socket

from flask import Blueprint, jsonify

from ..config import config

status_bp = Blueprint("status", __name__)


def _truthy(value) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _apm_target() -> str:
    url = os.getenv("DD_TRACE_AGENT_URL", "").strip()
    if url:
        return url
    host = os.getenv("DD_AGENT_HOST", "").strip()
    if host:
        return f"http://{host}:8126"
    return "http://localhost:8126"


def _tcp_reachable(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _reachable(url: str, timeout: float = 0.4) -> bool:
    """A unix socket is 'reachable' if the Agent created it; TCP we connect."""
    url = (url or "").strip()
    if not url:
        return False
    if url.startswith("unix://"):
        return os.path.exists(url[len("unix://"):])
    try:
        hostport = url.split("://", 1)[-1].split("/", 1)[0]
        host, _, port = hostport.partition(":")
        return _tcp_reachable(host, int(port or 8126), timeout)
    except Exception:
        return False


def _in_fargate() -> bool:
    return bool(
        os.getenv("ECS_CONTAINER_METADATA_URI_V4")
        or os.getenv("ECS_CONTAINER_METADATA_URI")
        or _truthy(os.getenv("ECS_FARGATE"))
    )


def _item(pid: str, label: str, state: str, detail: str) -> dict:
    return {"id": pid, "label": label, "status": state, "detail": detail}


def _products(apm_up: bool, apm_target: str) -> list:
    items = []

    # APM (tracing) — the runtime signal everything else leans on.
    if apm_up:
        items.append(_item("apm", "APM (tracing)", "on", f"ddtrace is reaching the Agent at {apm_target}."))
    else:
        items.append(_item("apm", "APM (tracing)", "error",
                           f"ddtrace can't reach the Agent at {apm_target}. Is the Agent sidecar running?"))

    # Log ↔ Trace correlation
    if _truthy(os.getenv("DD_LOGS_INJECTION")):
        items.append(_item("logs_injection", "Log ↔ Trace correlation", "on",
                           "DD_LOGS_INJECTION=true — logs carry dd.trace_id / dd.span_id."))
    else:
        items.append(_item("logs_injection", "Log ↔ Trace correlation", "off",
                           "Set DD_LOGS_INJECTION=true to correlate logs to traces."))

    # Runtime metrics (needs the Agent)
    if _truthy(os.getenv("DD_RUNTIME_METRICS_ENABLED")):
        items.append(_item("runtime", "Runtime metrics", "on" if apm_up else "error",
                           "Enabled and shipping via the Agent." if apm_up
                           else "Enabled but the Agent is unreachable."))
    else:
        items.append(_item("runtime", "Runtime metrics", "off", "Set DD_RUNTIME_METRICS_ENABLED=true."))

    # Custom metrics via DogStatsD (unix datagram socket)
    dsd = os.getenv("DD_DOGSTATSD_URL", "").strip()
    if dsd:
        dsd_up = _reachable(dsd)
        items.append(_item("dogstatsd", "Custom metrics (DogStatsD)", "on" if dsd_up else "error",
                           f"Socket present at {dsd}." if dsd_up
                           else f"DD_DOGSTATSD_URL set but {dsd} is unavailable."))
    else:
        items.append(_item("dogstatsd", "Custom metrics (DogStatsD)", "off",
                           "Set DD_DOGSTATSD_URL to emit custom metrics."))

    # Database Monitoring
    dbm = os.getenv("DD_DBM_PROPAGATION_MODE", "").strip().lower()
    if dbm in ("full", "service"):
        items.append(_item("dbm", "Database Monitoring", "on",
                           f"Query propagation = {dbm} (trace↔query). Full host-level DBM also needs the "
                           "`datadog` DB user on RDS."))
    else:
        items.append(_item("dbm", "Database Monitoring", "off",
                           "Set DD_DBM_PROPAGATION_MODE=full and create the `datadog` DB user on RDS."))

    # LLM Observability (enabled in-code via llmobs_setup)
    ml_app = os.getenv("DD_LLMOBS_ML_APP", "").strip()
    if ml_app:
        if apm_up:
            note = "" if os.getenv("OPENAI_API_KEY") else " OPENAI_API_KEY unset — Advisor runs in stub mode."
            items.append(_item("llmobs", "LLM Observability", "on",
                               f"Enabled in-code (ml_app={ml_app}); spans flow via the Agent.{note}"))
        else:
            items.append(_item("llmobs", "LLM Observability", "error",
                               f"Enabled (ml_app={ml_app}) but the Agent is unreachable."))
    else:
        items.append(_item("llmobs", "LLM Observability", "off", "Set DD_LLMOBS_ML_APP to enable."))

    # Infrastructure metrics (Agent-provided)
    if _in_fargate():
        items.append(_item("infra", "Infrastructure metrics", "on" if apm_up else "error",
                           "ECS Fargate task with the Datadog Agent sidecar." if apm_up
                           else "Fargate task detected but the Agent is unreachable."))
    else:
        items.append(_item("infra", "Infrastructure metrics", "on" if apm_up else "off",
                           "Agent reachable." if apm_up
                           else "No Datadog Agent detected (run the agent overlay locally)."))

    # Cloud Network Monitoring (ebpfless, on the Agent sidecar)
    items.append(_item("cnm", "Cloud Network Monitoring", "on" if apm_up else "off",
                       "Provided by the Agent sidecar (system-probe, ebpfless)." if apm_up
                       else "Requires the Datadog Agent sidecar (system-probe)."))

    # Backend Profiling
    if _truthy(os.getenv("DD_PROFILING_ENABLED")):
        items.append(_item("profiling", "Backend Profiling", "on" if apm_up else "error",
                           "DD_PROFILING_ENABLED=true." if apm_up else "Enabled but the Agent is unreachable."))
    else:
        items.append(_item("profiling", "Backend Profiling", "off",
                           "Set DD_PROFILING_ENABLED=true to profile the API."))

    # Source Code Integration
    if os.getenv("DD_GIT_COMMIT_SHA") and os.getenv("DD_GIT_REPOSITORY_URL"):
        items.append(_item("sci", "Source Code Integration", "on",
                           "DD_GIT_* present — traces/errors deep-link to source."))
    else:
        items.append(_item("sci", "Source Code Integration", "off",
                           "Set DD_GIT_REPOSITORY_URL and DD_GIT_COMMIT_SHA in CI to link telemetry to source."))

    return items


@status_bp.get("/api/status")
def status():
    apm_target = _apm_target()
    apm_up = _reachable(apm_target)
    return jsonify({
        "app": {
            "service": os.getenv("DD_SERVICE", "pay2play-backend"),
            "env": os.getenv("DD_ENV", "local"),
            "version": os.getenv("DD_VERSION", "dev"),
        },
        "agent": {"apmTarget": apm_target, "reachable": apm_up},
        "products": _products(apm_up, apm_target),
        "flags": {
            "transferLatencyMs": config.TRANSFER_LATENCY_MS,
            "transferFailRate": config.TRANSFER_FAIL_RATE,
        },
    })
