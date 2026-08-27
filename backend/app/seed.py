"""Idempotent demo data seeding.

Creates a couple of Pay2Play demo users, each with accounts and a bit of
transaction history. Safe to run repeatedly: it no-ops if users already exist.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .auth import hash_password
from .db import get_session
from .models import Account, Transaction, User

# password for every demo user is "Password123!"
_DEMO_PASSWORD = "Password123!"

_DEMO_USERS = [
    {
        "email": "ada@pay2play.test",
        "first_name": "Ada",
        "last_name": "Lovelace",
        "accounts": [
            {
                "account_number": "1000000001",
                "account_type": "checking",
                "transactions": [
                    ("credit", "2400.00", "Payroll deposit"),
                    ("debit", "72.19", "Grocery store"),
                    ("debit", "15.00", "Coffee shop"),
                    ("debit", "120.00", "Electric bill"),
                    ("credit", "50.00", "Refund"),
                ],
            },
            {
                "account_number": "2000000001",
                "account_type": "savings",
                "transactions": [
                    ("credit", "5000.00", "Opening balance"),
                    ("credit", "250.00", "Monthly transfer"),
                    ("credit", "250.00", "Monthly transfer"),
                ],
            },
        ],
    },
    {
        "email": "grace@pay2play.test",
        "first_name": "Grace",
        "last_name": "Hopper",
        "accounts": [
            {
                "account_number": "1000000002",
                "account_type": "checking",
                "transactions": [
                    ("credit", "3100.00", "Payroll deposit"),
                    ("debit", "899.00", "Rent"),
                    ("debit", "45.60", "Internet bill"),
                    ("debit", "210.75", "Groceries"),
                ],
            },
        ],
    },
]


def _build_transactions(session, account: Account, tx_specs: list) -> None:
    balance = Decimal("0.00")
    base_time = datetime.now(timezone.utc) - timedelta(days=len(tx_specs))
    for i, (kind, amount_str, description) in enumerate(tx_specs):
        amount = Decimal(amount_str)
        balance = balance + amount if kind == "credit" else balance - amount
        session.add(
            Transaction(
                account=account,
                kind=kind,
                amount=amount,
                description=description,
                balance_after=balance,
                created_at=base_time + timedelta(days=i),
            )
        )
    account.balance = balance


def seed() -> None:
    session = get_session()
    try:
        if session.query(User).count() > 0:
            return  # already seeded

        pw_hash = hash_password(_DEMO_PASSWORD)
        for u in _DEMO_USERS:
            user = User(
                email=u["email"],
                password_hash=pw_hash,
                first_name=u["first_name"],
                last_name=u["last_name"],
            )
            session.add(user)
            for acct in u["accounts"]:
                account = Account(
                    user=user,
                    account_number=acct["account_number"],
                    account_type=acct["account_type"],
                )
                session.add(account)
                _build_transactions(session, account, acct["transactions"])

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
