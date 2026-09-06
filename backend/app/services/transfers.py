"""Money-movement domain logic — delivery-agnostic.

Both the HTTP route (today) and a future queue consumer (streaming phase) call
`transfer(...)`, so the rule lives in exactly one place. Emits a domain event
via the publisher abstraction. See docs/backend-streaming-readiness.md.
"""

import random
import time
from decimal import Decimal

from ..config import config
from ..events import publish
from ..models import Account, Transaction, User


class TransferError(Exception):
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


def _maybe_inject_chaos() -> None:
    """Flag-gated fail/lag on transfers (env-driven now; feature flags later)."""
    if config.TRANSFER_LATENCY_MS > 0:
        time.sleep(config.TRANSFER_LATENCY_MS / 1000.0)
    if config.TRANSFER_FAIL_RATE > 0 and random.random() < config.TRANSFER_FAIL_RATE:
        raise TransferError("transfer failed (injected)", 502)


def transfer(session, sender_id: int, recipient_id: int, amount: Decimal, note: str | None = None) -> dict:
    """Atomically move `amount` from sender's primary account to recipient's.

    Increments the sender's transfer_count (for ranking) and publishes
    `transfer.completed`. Raises TransferError on any validation failure.
    """
    _maybe_inject_chaos()

    if amount <= 0:
        raise TransferError("amount must be positive")
    if sender_id == recipient_id:
        raise TransferError("cannot send to yourself")

    sender = session.get(User, sender_id)
    recipient = session.get(User, recipient_id)
    if sender is None or recipient is None:
        raise TransferError("recipient not found", 404)

    src = _primary_account(session, sender_id)
    dst = _primary_account(session, recipient_id)
    if src is None or dst is None:
        raise TransferError("account not found", 404)
    if src.balance < amount:
        raise TransferError("insufficient funds", 400)

    src.balance = src.balance - amount
    dst.balance = dst.balance + amount
    to_label = recipient.handle or recipient.first_name
    from_label = sender.handle or sender.first_name
    session.add(
        Transaction(
            account=src, kind="debit", amount=amount,
            description=note or f"Send to @{to_label}", balance_after=src.balance,
        )
    )
    session.add(
        Transaction(
            account=dst, kind="credit", amount=amount,
            description=f"From @{from_label}", balance_after=dst.balance,
        )
    )
    sender.transfer_count = (sender.transfer_count or 0) + 1
    session.commit()

    result = {
        "ok": True,
        "amount": float(amount),
        "toHandle": recipient.handle,
        "fromHandle": sender.handle,
        "senderBalance": float(src.balance),
        "transferCount": sender.transfer_count,
    }
    # Async side-effects (ledger, notifications, fraud, ranking) consume this.
    publish("transfer.completed", {
        "senderId": sender_id, "recipientId": recipient_id,
        "amount": float(amount), "senderHandle": sender.handle,
        "recipientHandle": recipient.handle, "senderTransferCount": sender.transfer_count,
    })
    return result
