"""In-code LLM Observability setup.

Mirrors the Datadog docs quickstart (LLMObs.enable). We call this while running
under `ddtrace-run` on purpose, to validate that the in-code setup works with
the ddtrace-run entrypoint. Agentless is off because a sidecar Agent is running,
so LLMObs spans flow through the Agent (UDS).
"""

import logging
import os

from ddtrace.llmobs import LLMObs

logger = logging.getLogger("pay2play")


def enable_llmobs() -> None:
    ml_app = os.getenv("DD_LLMOBS_ML_APP", "pay2play-chatbot")
    try:
        LLMObs.enable(
            ml_app=ml_app,
            api_key=os.getenv("DD_API_KEY"),
            site=os.getenv("DD_SITE", "datadoghq.com"),
            agentless_enabled=False,
        )
        logger.info("llmobs: enabled in-code under ddtrace-run (ml_app=%s)", ml_app)
    except Exception:
        logger.exception("llmobs: failed to enable (ml_app=%s)", ml_app)
