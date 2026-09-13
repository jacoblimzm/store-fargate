"""Datadog Feature Flags via OpenFeature (server-side).

Registers the Datadog OpenFeature provider at startup, then `flag_enabled(key)`
evaluates boolean flags that flip live from the Datadog UI. Used to gate the
security-demo (vuln lab). Fails safe: if flags aren't available, evaluations
return the default (False), so gated endpoints stay off.
"""

import logging
import os

from openfeature import api
from openfeature.evaluation_context import EvaluationContext

logger = logging.getLogger("pay2play")

_initialized = False


def init_feature_flags() -> None:
    """Register the Datadog provider once. Skipped without DD_API_KEY (e.g. local)."""
    global _initialized
    if _initialized or not os.getenv("DD_API_KEY"):
        return
    try:
        from ddtrace.openfeature import DataDogProvider

        api.set_provider(DataDogProvider())
        _initialized = True
        logger.info("feature flags: Datadog provider registered")
    except Exception:
        logger.exception("feature flags: registration failed (flags stay off)")


def is_ready() -> bool:
    return _initialized


def flag_enabled(key: str, default: bool = False) -> bool:
    """Return the flag's boolean value, or `default` if flags are off/unavailable."""
    if not _initialized:
        return default
    try:
        ctx = EvaluationContext(targeting_key="backend")
        return bool(api.get_client().get_boolean_value(key, default, ctx))
    except Exception:
        return default
