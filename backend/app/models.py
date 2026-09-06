from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Public @handle used for QR add + P2P. Nullable so legacy rows are valid;
    # seed + signup always set it.
    handle: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Odyssey baseline (never wiped by admin reset) vs ephemeral audience signup.
    is_seed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Cheap ranking counter for the "first to N transfers" leaderboard.
    transfer_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "handle": self.handle,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "transferCount": self.transfer_count,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    account_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    account_type: Mapped[str] = mapped_column(String(30), nullable=False)  # checking/savings
    balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"))

    user: Mapped["User"] = relationship(back_populates="accounts")
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        order_by="Transaction.created_at.desc()",
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "accountNumber": self.account_number,
            "accountType": self.account_type,
            "balance": float(self.balance),
        }


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id"), index=True, nullable=False
    )
    # "credit" (money in) or "debit" (money out)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.now()
    )

    account: Mapped["Account"] = relationship(back_populates="transactions")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "amount": float(self.amount),
            "description": self.description,
            "balanceAfter": float(self.balance_after),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class Contact(Base):
    """A directional friend link: `owner` has `contact` in their contact list.

    Used by the QR-add flow and P2P transfers. Kept simple (no reciprocity
    requirement) so the move-around-the-room demo is friction-free.
    """

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("owner_id", "contact_id", name="uq_contact_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    contact_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    contact: Mapped["User"] = relationship("User", foreign_keys=[contact_id])
