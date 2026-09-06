import random
import re
from decimal import Decimal

from flask import Blueprint, jsonify, request

from ..auth import create_access_token, hash_password
from ..config import config
from ..db import get_session
from ..models import Account, Transaction, User

signup_bp = Blueprint("signup", __name__)

_HANDLE_RE = re.compile(r"^[a-z0-9_]{3,30}$")
# Demo-grade: signups share the standard demo password so they can also log in.
_DEMO_PASSWORD = "Password123!"


@signup_bp.post("/api/signup")
def signup():
    """Public self-service onboarding: pick a username, get a wallet + token.

    Demo-grade auth (no email/password step) so ~500 attendees can join fast.
    """
    data = request.get_json(silent=True) or {}
    handle = (data.get("username") or data.get("handle") or "").strip().lstrip("@").lower()
    display = (data.get("displayName") or "").strip()

    if not _HANDLE_RE.match(handle):
        return jsonify({"error": "username must be 3-30 chars (letters, numbers, underscore)"}), 400

    session = get_session()
    try:
        email = f"{handle}@dcash.demo"
        if session.query(User).filter((User.handle == handle) | (User.email == email)).first():
            return jsonify({"error": "username already taken"}), 409

        parts = display.split(" ") if display else [handle]
        user = User(
            email=email,
            handle=handle,
            password_hash=hash_password(_DEMO_PASSWORD),
            first_name=parts[0][:100] or handle,
            last_name=" ".join(parts[1:])[:100],
            is_seed=False,
        )
        session.add(user)

        # Unique wallet account number (retry on the tiny chance of collision).
        number = None
        for _ in range(10):
            candidate = f"70{random.randint(0, 10**8):08d}"
            if not session.query(Account).filter_by(account_number=candidate).first():
                number = candidate
                break
        start = Decimal(config.SIGNUP_START_BALANCE)
        account = Account(user=user, account_number=number, account_type="wallet", balance=start)
        session.add(account)
        session.flush()
        session.add(
            Transaction(account=account, kind="credit", amount=start,
                        description="Welcome bonus", balance_after=start)
        )
        session.commit()

        token = create_access_token(user.id, user.email)
        return jsonify({"accessToken": token, "user": user.to_public_dict()}), 201
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
