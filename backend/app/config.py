import os


class Config:
    """Runtime configuration sourced from environment variables.

    Kept intentionally small; add sections here (e.g. Kafka brokers) as the
    app grows into async/worker territory.
    """

    # --- Database ---
    POSTGRES_USER = os.getenv("POSTGRES_USER", "pay2play")
    POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "pay2play_local_pw")
    POSTGRES_DB = os.getenv("POSTGRES_DB", "pay2play")
    POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
    POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")

    @property
    def database_url(self) -> str:
        # Allow a full override (e.g. RDS) via DATABASE_URL.
        override = os.getenv("DATABASE_URL")
        if override:
            return override
        return (
            f"postgresql+psycopg2://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # --- Auth ---
    JWT_SECRET = os.getenv("JWT_SECRET", "change-me-local-dev-secret")
    JWT_ALGORITHM = "HS256"
    JWT_EXP_MINUTES = int(os.getenv("JWT_EXP_MINUTES", "60"))

    # --- Behaviour ---
    SEED_ON_START = os.getenv("SEED_ON_START", "false").lower() in ("1", "true", "yes")


config = Config()
