"""One-shot startup task: wait for Postgres, create schema, optionally seed.

Runs once before gunicorn starts (see entrypoint.sh), so the web workers never
perform schema/seed side effects. Idempotent and safe to re-run.
"""

import logging
import time

from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.config import config
from app.db import engine, init_db
from app.logging_config import configure_logging

configure_logging()
logger = logging.getLogger("pay2play.init")


def wait_for_db(max_attempts: int = 30, delay_seconds: float = 2.0) -> None:
    for attempt in range(1, max_attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError:
            logger.warning("DB not ready (attempt %s/%s), retrying...", attempt, max_attempts)
            time.sleep(delay_seconds)
    raise RuntimeError("database did not become available in time")


def main() -> None:
    wait_for_db()
    init_db()
    logger.info("schema ready")

    if config.SEED_ON_START:
        from app.seed import seed

        seed()
        logger.info("seed complete")


if __name__ == "__main__":
    main()
