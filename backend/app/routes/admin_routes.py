from flask import Blueprint, jsonify, request
from sqlalchemy import or_

from ..config import config
from ..db import get_session
from ..models import Contact, User

admin_bp = Blueprint("admin", __name__)


@admin_bp.post("/api/admin/reset")
def reset():
    """Flush all ephemeral (non-seed) users + their data; keep the baseline.

    Guarded by the X-Admin-Token header. Lets us wipe and re-run for back-to-back
    audiences without touching the Odyssey baseline.
    """
    if request.headers.get("X-Admin-Token") != config.ADMIN_TOKEN:
        return jsonify({"error": "forbidden"}), 403

    session = get_session()
    try:
        ids = [uid for (uid,) in session.query(User.id).filter(User.is_seed.is_(False)).all()]
        if ids:
            # Contacts reference users on both sides (no ORM cascade) — clear first.
            session.query(Contact).filter(
                or_(Contact.owner_id.in_(ids), Contact.contact_id.in_(ids))
            ).delete(synchronize_session=False)
            # ORM delete cascades accounts -> transactions per relationship config.
            for user in session.query(User).filter(User.id.in_(ids)).all():
                session.delete(user)
            session.commit()
        return jsonify({"deletedUsers": len(ids)})
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
