"""Database connection: Supabase Postgres in production, SQLite for local development and tests."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from .config import ROOT, settings

IS_SQLITE = not bool(settings.database_url)
DB_PATH: Path | None = Path(os.getenv("WAYMARK_DB", ROOT / "waymark.db")) if IS_SQLITE else None

if IS_SQLITE:
    assert DB_PATH is not None
    engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(connection, _record) -> None:
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()
else:
    url = make_url(settings.database_url or "")
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername != "postgresql+psycopg":
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL (postgresql:// or postgres://).")
    # Render Free uses a small instance. Keep the application pool bounded; session-pooler URLs
    # are supported for IPv4-only outbound networks.
    # Avoid leaving local checks and app startup waiting on an unreachable or unhealthy
    # database for libpq's much longer default connection timeout.
    engine = create_engine(
        # Pass SQLAlchemy's URL object directly. ``str(url)`` hides the password as
        # ``***``, which would make the driver authenticate with the masked value.
        url,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=0,
        pool_recycle=1800,
        connect_args={"connect_timeout": 5},
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def configure_sqlite() -> None:
    """Enable WAL once at startup for the local SQLite database."""
    if not IS_SQLITE:
        return
    with engine.connect() as connection:
        mode = connection.exec_driver_sql("PRAGMA journal_mode=WAL").scalar_one()
        if str(mode).lower() != "wal":
            raise RuntimeError(f"Could not enable SQLite WAL mode (got {mode!r})")


def validate_postgres_schema() -> None:
    """Fail fast instead of serving requests against an uninitialized Supabase project."""
    required = {"cells", "cell_shap", "cell_scenarios", "yearly_counts", "data_quality", "metrics", "crashes",
                "reports", "measures", "measure_cells", "evidence", "measure_events", "chat_sessions",
                "chat_messages", "risk_snapshots", "accounts"}
    missing = required - set(inspect(engine).get_table_names())
    if missing:
        names = ", ".join(sorted(missing))
        raise RuntimeError(f"Supabase schema is incomplete; apply the checked-in migrations first. Missing: {names}")


def get_db():
    """SQLite would silently create an empty database, so check its file before serving requests."""
    if IS_SQLITE and (DB_PATH is None or not DB_PATH.exists()):
        raise HTTPException(503, f"Database not found at {DB_PATH}. Run: python pipeline/load_db.py")
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
