"""Structured JSON logging via python-json-logger.

Listing the dd.* attributes in the format string is all that's needed for
log<>trace correlation: ddtrace (with DD_LOGS_INJECTION under ddtrace-run)
populates them on each record, and Datadog links logs to traces.
See https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/python/
"""

import logging

from pythonjsonlogger.json import JsonFormatter

_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s %(message)s "
    "%(dd.trace_id)s %(dd.span_id)s %(dd.service)s %(dd.env)s %(dd.version)s"
)
_RENAME = {"asctime": "timestamp", "levelname": "level", "name": "logger"}


def json_formatter() -> logging.Formatter:
    return JsonFormatter(_FORMAT, rename_fields=_RENAME)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(json_formatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
