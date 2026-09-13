"""Security-demo (vuln lab) endpoints — OWASP Top 10:2025 runtime examples.

⚠️ INTENTIONALLY VULNERABLE. Every endpoint here is gated behind the Datadog
feature flag `vuln-lab-enabled` (evaluated per request). When the flag is off
(the default), the whole blueprint returns 404 — so nothing is exploitable on
the public app unless the flag is flipped on in the Datadog UI for an App Sec
demo. See app/security_demo.py for the SAST-only categories.
"""

import base64
import pickle

import requests
from flask import Blueprint, abort, g, jsonify, request
from sqlalchemy import text

from ..auth import require_auth
from ..db import get_session
from ..feature_flags import flag_enabled
from ..models import Account

vuln_bp = Blueprint("vuln", __name__)

VULN_FLAG = "vuln-lab-enabled"


@vuln_bp.before_request
def _gate():
    # Off unless the Datadog feature flag is on — flips live from the DD UI.
    if not flag_enabled(VULN_FLAG, False):
        abort(404)


# --- A01:2025 Broken Access Control — IDOR (no ownership check) ------------
@vuln_bp.get("/api/vuln/account/<int:account_id>")
@require_auth
def vuln_account(account_id):
    session = get_session()
    try:
        acct = session.get(Account, account_id)  # never checks acct.user_id == g.user_id
        if acct is None:
            return jsonify({"error": "not found"}), 404
        return jsonify({
            "id": acct.id,
            "accountNumber": acct.account_number,
            "type": acct.account_type,
            "balance": float(acct.balance),
            "ownerUserId": acct.user_id,
        })
    finally:
        session.close()


# --- A01:2025 Broken Access Control — SSRF (CWE-918, now folded into A01) ---
@vuln_bp.get("/api/vuln/fetch")
@require_auth
def vuln_fetch():
    url = request.args.get("url", "")
    resp = requests.get(url, timeout=5)  # no allowlist / no scheme or host validation
    return jsonify({"status": resp.status_code, "body": resp.text[:2000]})


# --- A05:2025 Injection — SQL built by string interpolation ----------------
@vuln_bp.get("/api/vuln/search")
@require_auth
def vuln_search():
    handle = request.args.get("handle", "")
    session = get_session()
    try:
        query = text(f"SELECT id, handle, first_name, last_name FROM users WHERE handle = '{handle}'")
        rows = session.execute(query).mappings().all()
        return jsonify([dict(r) for r in rows])
    finally:
        session.close()


# --- A08:2025 Software or Data Integrity — insecure deserialization --------
@vuln_bp.post("/api/vuln/import")
@require_auth
def vuln_import():
    raw = (request.get_json(silent=True) or {}).get("data", "")
    obj = pickle.loads(base64.b64decode(raw))  # RCE via untrusted pickle
    return jsonify({"loaded": str(obj)[:500]})
