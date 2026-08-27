#!/bin/sh
set -e

# One-shot: wait for DB, create schema, seed (idempotent).
python init_db.py

# Start the web server the regular way. When a Datadog agent is reachable,
# wrap gunicorn with ddtrace-run to enable APM. Both local compose and Fargate
# use a Unix Domain Socket (DD_TRACE_AGENT_URL); DD_AGENT_HOST is kept only as a
# generic TCP fallback and is intentionally NOT set in our environments.
# Otherwise run plain gunicorn (Phase 1 / no observability).
if [ -n "$DD_AGENT_HOST" ] || [ -n "$DD_TRACE_AGENT_URL" ]; then
    echo "Datadog agent configured -> starting gunicorn under ddtrace-run"
    exec ddtrace-run gunicorn -c gunicorn.conf.py wsgi:app
else
    exec gunicorn -c gunicorn.conf.py wsgi:app
fi
