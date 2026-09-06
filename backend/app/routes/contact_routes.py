from flask import Blueprint, g, jsonify, request

from ..auth import require_auth
from ..db import get_session
from ..models import Contact, User

contact_bp = Blueprint("contact", __name__)


def _parse_handle(raw: str) -> str:
    """Accept a raw handle or a QR payload like 'dcash:@odysseus'."""
    value = (raw or "").strip()
    if ":" in value:
        value = value.split(":", 1)[1]
    return value.lstrip("@").lower()


def _contact_view(user: User) -> dict:
    return {
        "id": user.id,
        "handle": user.handle,
        "name": f"{user.first_name} {user.last_name}".strip(),
    }


def _add_contact(session, owner_id: int, handle: str):
    handle = _parse_handle(handle)
    if not handle:
        return jsonify({"error": "handle required"}), 400
    target = session.query(User).filter_by(handle=handle).one_or_none()
    if target is None:
        return jsonify({"error": "no user with that handle"}), 404
    if target.id == owner_id:
        return jsonify({"error": "cannot add yourself"}), 400
    existing = session.query(Contact).filter_by(owner_id=owner_id, contact_id=target.id).first()
    if existing is None:
        session.add(Contact(owner_id=owner_id, contact_id=target.id))
        session.commit()
    return jsonify(_contact_view(target)), 201


@contact_bp.get("/api/contacts")
@require_auth
def list_contacts():
    session = get_session()
    try:
        rows = (
            session.query(User)
            .join(Contact, Contact.contact_id == User.id)
            .filter(Contact.owner_id == g.user_id)
            .order_by(User.first_name)
            .all()
        )
        return jsonify([_contact_view(u) for u in rows])
    finally:
        session.close()


@contact_bp.post("/api/contacts")
@require_auth
def add_contact():
    data = request.get_json(silent=True) or {}
    session = get_session()
    try:
        return _add_contact(session, g.user_id, data.get("handle", ""))
    finally:
        session.close()


@contact_bp.post("/api/contacts/scan")
@require_auth
def scan_contact():
    data = request.get_json(silent=True) or {}
    session = get_session()
    try:
        return _add_contact(session, g.user_id, data.get("payload") or data.get("handle", ""))
    finally:
        session.close()


@contact_bp.get("/api/me/qr")
@require_auth
def my_qr():
    session = get_session()
    try:
        user = session.get(User, g.user_id)
        if user is None:
            return jsonify({"error": "user not found"}), 404
        # The frontend renders this payload as a QR others scan to add you.
        return jsonify({"handle": user.handle, "payload": f"dcash:@{user.handle}"})
    finally:
        session.close()
