"""Domain-event publisher abstraction.

Business code emits events via `publish("transfer.completed", {...})` today. The
default backend is a no-op that just logs, so event-emitting code ships with the
features and is exercised locally/in tests with zero infrastructure.

The streaming phase adds a real backend (SQS/SNS, Kafka) as a new adapter and
selects it via the EVENT_BACKEND env var — no change to any call site. See
docs/backend-streaming-readiness.md for the rationale.
"""

import logging
import os
from typing import Protocol

logger = logging.getLogger("pay2play.events")


class Publisher(Protocol):
    def publish(self, event: str, payload: dict) -> None: ...


class NoopPublisher:
    """Local/dev/test default: log the event, send nothing."""

    def publish(self, event: str, payload: dict) -> None:
        logger.info("event %s %s", event, payload)


# Future adapters (added in the streaming phase), selected by EVENT_BACKEND:
#   class SqsPublisher: ...      # boto3, DSM auto-instrumented by ddtrace
#   class KafkaPublisher: ...    # confluent-kafka, DSM auto-instrumented
_BACKENDS = {
    "noop": NoopPublisher,
}


def _make_publisher() -> Publisher:
    name = os.getenv("EVENT_BACKEND", "noop").lower()
    factory = _BACKENDS.get(name, NoopPublisher)
    return factory()


_publisher: Publisher = _make_publisher()


def publish(event: str, payload: dict) -> None:
    """Emit a domain event through the configured backend."""
    _publisher.publish(event, payload)
