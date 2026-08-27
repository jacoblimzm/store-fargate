from flask import Blueprint, g, jsonify

from ..auth import require_auth
from ..db import get_session
from ..models import User

user_bp = Blueprint("user", __name__)


@user_bp.get("/api/users/me")
@require_auth
def me():
    session = get_session()
    try:
        user = session.get(User, g.user_id)
        if user is None:
            return jsonify({"error": "user not found"}), 404
        return jsonify(user.to_public_dict())
    finally:
        session.close()
