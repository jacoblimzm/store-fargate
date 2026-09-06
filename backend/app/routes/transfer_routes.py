from decimal import Decimal, InvalidOperation

from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..db import get_session
from ..models import User
from ..services import transfers

transfer_bp = Blueprint("transfer", __name__)


@transfer_bp.post("/api/transfers")
@require_auth
def create_transfer():
    """P2P transfer between real users. Thin: parse -> resolve -> delegate."""
    data = request.get_json(silent=True) or {}
    try:
        amount = Decimal(str(data.get("amount")))
    except (InvalidOperation, TypeError):
        return jsonify({"error": "invalid amount"}), 400

    session = get_session()
    try:
        recipient = None
        if data.get("toHandle"):
            handle = str(data["toHandle"]).lstrip("@").lower()
            recipient = session.query(User).filter_by(handle=handle).one_or_none()
        elif data.get("toUserId"):
            recipient = session.get(User, int(data["toUserId"]))
        if recipient is None:
            return jsonify({"error": "recipient not found"}), 404

        result = transfers.transfer(session, g.user_id, recipient.id, amount, data.get("note"))
        return jsonify(result)
    except transfers.TransferError as e:
        session.rollback()
        return jsonify({"error": e.message}), e.status
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
