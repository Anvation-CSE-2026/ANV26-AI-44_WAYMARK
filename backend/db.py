"""Database connection. The path comes from WAYMARK_DB (default: waymark.db in the project root)."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("WAYMARK_DB", ROOT / "waymark.db"))

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    # SQLite's default lock wait is only five seconds. Give an in-flight write
    # time to finish instead of failing concurrent API requests immediately.
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _configure_sqlite_connection(connection, _record) -> None:
    cursor = connection.cursor()
    try:
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def configure_sqlite() -> None:
    """Enable WAL once at startup so reads can continue during writes."""
    with engine.connect() as connection:
        mode = connection.exec_driver_sql("PRAGMA journal_mode=WAL").scalar_one()
        if str(mode).lower() != "wal":
            raise RuntimeError(f"Could not enable SQLite WAL mode (got {mode!r})")


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    """FastAPI dependency. SQLite would silently create an empty file, so check it exists first."""
    if not DB_PATH.exists():
        raise HTTPException(503, f"Database not found at {DB_PATH}. Run: python pipeline/load_db.py")
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
