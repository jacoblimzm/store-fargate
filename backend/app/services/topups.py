"""Wallet top-up domain logic — delivery-agnostic.

Credits the signed-in customer's primary wallet from a (simulated) funding
source, records a credit transaction, and publishes a domain event. Mirrors
`transfers.py` so the rule lives in exactly one place for both the HTTP route
today and any future queue consumer.
"""

from decimal import Decimal

from ..events import publish
from ..models import Account, Transaction, User

# Sane demo ceiling so a fat-fingered amount can't mint a silly balance.
MAX_TOPUP = Decimal("10000")


class TopUpError(Exception):
    """Domain error with an HTTP-friendly status for the route to surface."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _primary_account(session, user_id: int) -> Account | None:
    return (
        session.query(Account)
        .filter(Account.user_id == user_id)
        .order_by(Account.id)
        .first()
    )


def top_up(session, user_id: int, amount: Decimal, source: str | None = None) -> dict:
    """Credit `amount` to the user's primary wallet and record the transaction."""
    if amount <= 0:
        raise TopUpError("amount must be positive")
    if amount > MAX_TOPUP:
        raise TopUpError(f"amount exceeds the ${MAX_TOPUP:,.0f} top-up limit")

    user = session.get(User, user_id)
    if user is None:
        raise TopUpError("user not found", 404)

    acct = _primary_account(session, user_id)
    if acct is None:
        raise TopUpError("account not found", 404)

    acct.balance = acct.balance + amount
    description = f"Top up · {source}" if source else "Top up"
    session.add(
        Transaction(
            account=acct, kind="credit", amount=amount,
            description=description, balance_after=acct.balance,
        )
    )
    session.commit()

    result = {
        "ok": True,
        "amount": float(amount),
        "balance": float(acct.balance),
        "accountId": acct.id,
    }
    publish("wallet.topped_up", {
        "userId": user_id, "amount": float(amount),
        "balance": float(acct.balance), "source": source,
    })
    return result
