from flask import Blueprint, g, jsonify

from ..auth import require_auth
from ..db import get_session
from ..models import Account

account_bp = Blueprint("account", __name__)


@account_bp.get("/api/accounts")
@require_auth
def list_accounts():
    session = get_session()
    try:
        accounts = (
            session.query(Account).filter(Account.user_id == g.user_id).all()
        )
        return jsonify([a.to_dict() for a in accounts])
    finally:
        session.close()


@account_bp.get("/api/accounts/<int:account_id>/transactions")
@require_auth
def account_transactions(account_id: int):
    session = get_session()
    try:
        account = (
            session.query(Account)
            .filter(Account.id == account_id, Account.user_id == g.user_id)
            .one_or_none()
        )
        if account is None:
            return jsonify({"error": "account not found"}), 404
        return jsonify(
            {
                "account": account.to_dict(),
                "transactions": [t.to_dict() for t in account.transactions],
            }
        )
    finally:
        session.close()
