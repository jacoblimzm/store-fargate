from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "firstName": self.first_name,
            "lastName": self.last_name,
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
