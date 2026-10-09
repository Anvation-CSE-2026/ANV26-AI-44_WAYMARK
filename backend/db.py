"""Database connection. The path comes from WAYMARK_DB (default: waymark.db in the project root)."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("WAYMARK_DB", ROOT / "waymark.db"))

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
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
