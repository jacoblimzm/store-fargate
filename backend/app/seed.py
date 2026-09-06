"""Idempotent demo seeding — the persistent DCash baseline.

Every baseline user maps to a character from Homer's *The Odyssey* (is_seed=True),
each with a wallet, a little history, and a few seeded contacts so P2P transfers
work out of the box. Safe to run repeatedly; the admin reset never removes these.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .auth import hash_password
from .db import get_session
from .models import Account, Contact, Transaction, User

# password for every baseline user is "Password123!"
_DEMO_PASSWORD = "Password123!"

# Complete-ish cast, grouped for easy extension: (handle, first_name, last_name).
_ROSTER: list[tuple[str, str, str]] = [
    # Protagonists (Ithaca)
    ("odysseus", "Odysseus", "Laertiades"),
    ("penelope", "Penelope", "of Ithaca"),
    ("telemachus", "Telemachus", "Odysseus-son"),
    ("laertes", "Laertes", "Arcesiades"),
    ("eurycleia", "Eurycleia", "Ops-daughter"),
    ("argos", "Argos", "the Hound"),
    # Gods & immortals
    ("athena", "Athena", "Pallas"),
    ("zeus", "Zeus", "Kronides"),
    ("poseidon", "Poseidon", "Earth-shaker"),
    ("hermes", "Hermes", "Argeiphontes"),
    ("calypso", "Calypso", "of Ogygia"),
    ("circe", "Circe", "of Aeaea"),
    ("aeolus", "Aeolus", "Hippotades"),
    ("helios", "Helios", "Hyperion"),
    # Ithaca / suitors & servants
    ("antinous", "Antinous", "Eupeithes-son"),
    ("eurymachus", "Eurymachus", "Polybus-son"),
    ("amphinomus", "Amphinomus", "Nisus-son"),
    ("eumaeus", "Eumaeus", "the Swineherd"),
    ("philoetius", "Philoetius", "the Cowherd"),
    ("melanthius", "Melanthius", "Dolios-son"),
    # Pylos & Sparta
    ("nestor", "Nestor", "of Pylos"),
    ("menelaus", "Menelaus", "Atreides"),
    ("helen", "Helen", "of Sparta"),
    ("peisistratus", "Peisistratus", "Nestor-son"),
    # Phaeacians
    ("alcinous", "Alcinous", "of Scheria"),
    ("arete", "Arete", "of Scheria"),
    ("nausicaa", "Nausicaa", "Alcinous-daughter"),
    ("demodocus", "Demodocus", "the Bard"),
    # The wanderings
    ("polyphemus", "Polyphemus", "the Cyclops"),
    ("tiresias", "Tiresias", "the Seer"),
    ("elpenor", "Elpenor", "the Comrade"),
    ("eurylochus", "Eurylochus", "the Comrade"),
]

_BASE_TXNS = [
    ("credit", "5000.00", "Cash-in"),
    ("debit", "150.00", "Buy load"),
    ("debit", "320.00", "Pay bills"),
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
        pw_hash = hash_password(_DEMO_PASSWORD)
        by_handle: dict[str, User] = {}

        # Users + wallets (idempotent per email).
        for i, (handle, first, last) in enumerate(_ROSTER):
            email = f"{handle}@dcash.demo"
            user = session.query(User).filter_by(email=email).first()
            if user is None:
                user = User(
                    email=email,
                    handle=handle,
                    password_hash=pw_hash,
                    first_name=first,
                    last_name=last,
                    is_seed=True,
                )
                session.add(user)
                account = Account(user=user, account_number=f"90{i:08d}", account_type="wallet")
                session.add(account)
                _build_transactions(session, account, _BASE_TXNS)
            else:
                # Backfill identity on pre-existing rows.
                user.handle = user.handle or handle
                user.is_seed = True
            by_handle[handle] = user

        session.flush()  # assign ids for contact links

        # Seed contacts: each user knows the next 3 in the roster (directional).
        handles = [h for h, _, _ in _ROSTER]
        n = len(handles)
        for i, handle in enumerate(handles):
            owner = by_handle[handle]
            for j in range(1, 4):
                other = by_handle[handles[(i + j) % n]]
                if owner.id == other.id:
                    continue
                exists = (
                    session.query(Contact)
                    .filter_by(owner_id=owner.id, contact_id=other.id)
                    .first()
                )
                if exists is None:
                    session.add(Contact(owner_id=owner.id, contact_id=other.id))

        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
