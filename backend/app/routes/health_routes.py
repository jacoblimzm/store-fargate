from flask import Blueprint, jsonify
from sqlalchemy import text

from ..db import get_session

health_bp = Blueprint("health", __name__)


@health_bp.get("/api/health")
def health():
    """Liveness + DB connectivity check (used by compose and Fargate)."""
    db_ok = True
    session = get_session()
    try:
        session.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    finally:
        session.close()

    status = 200 if db_ok else 503
    return jsonify({"status": "ok" if db_ok else "degraded", "db": db_ok}), status
