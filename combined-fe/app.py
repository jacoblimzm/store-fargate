"""Minimal Flask app for the combined nginx+python POC container.

Its only job is to emit structured JSON logs (identical in shape to the real
pay2play-backend) to stdout, so that a single container produces BOTH nginx
plaintext logs and app JSON logs -- reproducing the customer's "one container,
two log formats, one dd_source" problem. See combined-fe/README-ish notes in
the task: nginx logs go to source:nginx via a Fluent Bit rewrite_tag split,
while these JSON lines stay on the container's catch-all source:python output.
"""

import logging

from flask import Flask, request
from pythonjsonlogger.json import JsonFormatter

_FORMAT = (
    "%(asctime)s %(levelname)s %(name)s %(message)s "
    "%(dd.trace_id)s %(dd.span_id)s %(dd.service)s %(dd.env)s %(dd.version)s"
)
_RENAME = {"asctime": "timestamp", "levelname": "level", "name": "logger"}


def _configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter(_FORMAT, rename_fields=_RENAME))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


_configure_logging()
logger = logging.getLogger("pay2play-combined-fe")

app = Flask(__name__)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    return {"service": "pay2play-combined-fe"}


@app.get("/api/pay")
def pay():
    # Deliberately logs sensitive data (a classic mistake) so we can prove
    # Fluent Bit obfuscation redacts it BEFORE the log ships to Datadog.
    logger.info("charge ok card=4111111111111111 email=ada@pay2play.test amount=42.00")
    return {"status": "charged"}


@app.after_request
def _log_request(response):
    logger.info("%s %s %s", request.method, request.path, response.status_code)
    return response
