from decimal import Decimal, InvalidOperation

from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..db import get_session
from ..services import topups

topup_bp = Blueprint("topup", __name__)


@topup_bp.post("/api/topup")
@require_auth
def create_topup():
    """Top up the signed-in user's wallet. Thin: parse -> delegate."""
    data = request.get_json(silent=True) or {}
    try:
        amount = Decimal(str(data.get("amount")))
    except (InvalidOperation, TypeError):
        return jsonify({"error": "invalid amount"}), 400

    session = get_session()
    try:
        result = topups.top_up(session, g.user_id, amount, data.get("source"))
        return jsonify(result)
    except topups.TopUpError as e:
        session.rollback()
        return jsonify({"error": e.message}), e.status
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
