import os

# Standard gunicorn setup with sync workers.
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
workers = int(os.getenv("GUNICORN_WORKERS", "2"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))

errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")

# Emit gunicorn's own (startup/error) logs as JSON too, using the app formatter.
# Request logging is done in-app (after_request) so it lands inside the trace
# span and gets dd.trace_id/dd.span_id.
logconfig_dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "app.logging_config.json_formatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"level": "INFO", "handlers": ["console"]},
    "loggers": {
        "gunicorn.error": {"level": "INFO", "handlers": ["console"], "propagate": False},
    },
}
