"""Datadog Feature Flags via OpenFeature (server-side).

Registers the Datadog OpenFeature provider (agentless: needs DD_API_KEY +
DD_SITE + DD_ENV in the process) so backend code can evaluate flags that flip
live from the Datadog UI. Used to gate the security-demo (vuln lab) endpoints.

Safe by default: if the provider can't initialize (e.g. no API key locally),
`flag_enabled` returns the caller-provided default (False), so gated endpoints
stay off.
"""

import logging
import os

logger = logging.getLogger("pay2play")

_initialized = False


def init_feature_flags() -> None:
    """Register the Datadog OpenFeature provider once, at app startup."""
    global _initialized
    if _initialized:
        return
    # Agentless flag delivery needs an API key + site; skip (and keep flags off)
    # when they're absent so local dev doesn't block on CDN polling.
    if not os.getenv("DD_API_KEY"):
        logger.info("feature flags: DD_API_KEY unset; provider not registered (flags default to off)")
        return
    try:
        from ddtrace.openfeature import DataDogProvider
        from openfeature import api

        api.set_provider(DataDogProvider())
        _initialized = True
        logger.info("feature flags: Datadog OpenFeature provider registered")
    except Exception:
        logger.exception("feature flags: provider registration failed (flags default to off)")


def is_ready() -> bool:
    return _initialized


def flag_enabled(key: str, default: bool = False, targeting_key: str = "backend", attributes: dict | None = None) -> bool:
    """Evaluate a boolean flag; returns `default` on any error."""
    try:
        from openfeature import api
        from openfeature.evaluation_context import EvaluationContext

        client = api.get_client()
        ctx = EvaluationContext(targeting_key=targeting_key, attributes=attributes or {})
        return bool(client.get_boolean_value(key, default, ctx))
    except Exception:
        logger.debug("feature flags: eval failed for %s; using default", key)
        return default
