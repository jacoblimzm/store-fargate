from flask import Blueprint, jsonify, request

from ..auth import create_access_token, verify_password
from ..db import get_session
from ..models import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    session = get_session()
    try:
        user = session.query(User).filter(User.email == email).one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            return jsonify({"error": "invalid credentials"}), 401

        token = create_access_token(user.id, user.email)
        return jsonify({"accessToken": token, "user": user.to_public_dict()})
    finally:
        session.close()
