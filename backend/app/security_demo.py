"""OWASP Top 10:2025 — intentional vulnerabilities for the Datadog security demo.

⚠️ INTENTIONALLY VULNERABLE — DO NOT copy into real code. These exist so Datadog
Code Security (SAST) flags one weakness per OWASP 2025 category, and so App Sec
(ASM) can show runtime detection/blocking for a subset. The runtime-reachable
examples (A01 IDOR + SSRF, A05 SQLi, A08 pickle) live in routes/vuln_routes.py
and are gated behind the `vuln-lab-enabled` Datadog feature flag.

Reference: https://owasp.org/Top10/2025/
"""

import hashlib
import logging
import subprocess

from sqlalchemy import text

logger = logging.getLogger("pay2play")


# --- A02:2025 Security Misconfiguration (CWE-16) ---------------------------
# Debug server bound to all interfaces leaks the interactive debugger + PIN.
def run_debug_server(app):
    app.run(host="0.0.0.0", debug=True)


# --- A03:2025 Software Supply Chain Failures (CWE-1104) --------------------
# The pinned `requests==2.31.0` (CVE-2024-35195) in requirements.txt is the SCA
# finding. Installing packages from an untrusted source over plain HTTP is the
# other half of the supply-chain risk (also a command injection via shell=True).
def install_untrusted_package():
    subprocess.call("pip install http://packages.internal.example/pkg.tar.gz", shell=True)


# --- A04:2025 Cryptographic Failures (CWE-327 / CWE-798) -------------------
HARDCODED_SIGNING_KEY = "s3cr3t-demo-signing-key-do-not-use"  # hardcoded secret


def weak_password_hash(password: str) -> str:
    # MD5 is broken for password storage (fast, unsalted, collidable).
    return hashlib.md5(password.encode()).hexdigest()


# --- A05:2025 Injection — SQL built by string interpolation (CWE-89) --------
# User input formatted straight into cursor.execute() (no parameterization).
def user_by_handle(cursor, handle: str):
    cursor.execute(f"SELECT id, handle, first_name FROM users WHERE handle = '{handle}'")
    return cursor.fetchall()


# --- A06:2025 Insecure Design (business-logic flaw) ------------------------
# Money movement with no authorization, no rate limit, no idempotency key, and
# no amount validation (negative amounts would reverse the transfer).
def transfer_no_controls(session, from_id: int, to_id: int, amount) -> None:
    session.execute(text("UPDATE accounts SET balance = balance - :a WHERE id = :f"), {"a": amount, "f": from_id})
    session.execute(text("UPDATE accounts SET balance = balance + :a WHERE id = :t"), {"a": amount, "t": to_id})
    session.commit()


# --- A07:2025 Authentication Failures (CWE-521 / CWE-307) ------------------
def password_meets_policy(pw: str) -> bool:
    return len(pw) >= 1  # accepts any non-empty password; no complexity, no lockout


# --- A09:2025 Security Logging & Alerting Failures (CWE-532) ---------------
def log_login(username: str, password: str) -> None:
    # Logs the plaintext credential — sensitive data in logs, and no alerting on
    # repeated failures.
    logger.info("login attempt user=%s password=%s", username, password)


# --- A10:2025 Mishandling of Exceptional Conditions (CWE-636 / 703 / 209) --
def authorize_fail_open(check) -> bool:
    try:
        return bool(check())
    except Exception:
        # Fails OPEN: on any error the caller is granted access.
        return True


def swallow_everything(fn):
    try:
        return fn()
    except Exception:
        pass  # error silently swallowed — nothing logged, nothing alerted
