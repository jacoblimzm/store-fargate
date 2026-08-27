import logging

from flask import Flask, request
from flask_cors import CORS

from .db import SessionLocal
from .logging_config import configure_logging

logger = logging.getLogger("pay2play")


def create_app() -> Flask:
    """Application factory: wire up config, extensions and routes.

    Kept side-effect free (no DB schema creation or seeding here) so it behaves
    predictably under multiple gunicorn workers and under APM instrumentation.
    Schema creation + seeding happen once at startup via init_db.py.
    """
    configure_logging()
    app = Flask(__name__)
    CORS(app)

    from .routes import account_bp, auth_bp, health_bp, user_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(user_bp)
    app.register_blueprint(account_bp)

    @app.after_request
    def _log_request(response):
        # Logged inside the active request span, so ddtrace injects
        # dd.trace_id / dd.span_id and the log links to its trace.
        logger.info("%s %s %s", request.method, request.path, response.status_code)
        return response

    @app.teardown_appcontext
    def remove_session(exception=None):  # noqa: ANN001
        SessionLocal.remove()

    return app
