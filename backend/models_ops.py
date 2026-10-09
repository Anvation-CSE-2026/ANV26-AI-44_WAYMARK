"""Tables added by the operations build (accounts, reports, measures, evidence, chat, risk snapshots).

They are created at start-up with `create_ops_tables`, which only creates tables that do not exist yet. The
original tables (cells, crashes, ...) are never altered.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Mapped, mapped_column

from .models import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)   # stored as naive UTC


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    region_kind: Mapped[str] = mapped_column(String)
    region_key: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")           # pending / ready / failed
    error_safe: Mapped[str | None] = mapped_column(Text)
    payload_json: Mapped[str | None] = mapped_column(Text)
    pdf_path: Mapped[str | None] = mapped_column(String)
    schema_version: Mapped[str] = mapped_column(String)
    data_version: Mapped[str | None] = mapped_column(String)
    created_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (Index("ix_reports_region", "region_kind", "region_key", "created_at"),)


class Measure(Base):
    __tablename__ = "measures"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    report_id: Mapped[str | None] = mapped_column(ForeignKey("reports.report_id"), nullable=True)
    region_kind: Mapped[str] = mapped_column(String)
    region_key: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)
    owner_role: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="planned", index=True)
    effect_weight_snapshot: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String, default="manual")             # chat / manual
    created_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("ix_measures_region", "region_kind", "region_key"),)


class MeasureCell(Base):
    __tablename__ = "measure_cells"
    measure_id: Mapped[int] = mapped_column(ForeignKey("measures.id"), primary_key=True)
    cell_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    measure_id: Mapped[int] = mapped_column(ForeignKey("measures.id"), index=True)
    kind: Mapped[str] = mapped_column(String)                                 # before / during / after
    file_name: Mapped[str] = mapped_column(String)
    thumb_name: Mapped[str] = mapped_column(String)
    sha256: Mapped[str] = mapped_column(String)
    caption: Mapped[str | None] = mapped_column(String)
    exif_taken_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    geo_flag: Mapped[str] = mapped_column(String, default="missing")          # ok / far / missing
    stale_photo: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("measure_id", "sha256", name="uq_evidence_measure_sha"),)


class MeasureEvent(Base):
    __tablename__ = "measure_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    measure_id: Mapped[int] = mapped_column(ForeignKey("measures.id"))
    type: Mapped[str] = mapped_column(String)                 # created / transition / comment / evidence / verify / reject
    from_status: Mapped[str | None] = mapped_column(String)
    to_status: Mapped[str | None] = mapped_column(String)
    actor: Mapped[str] = mapped_column(String)
    actor_role: Mapped[str] = mapped_column(String)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (Index("ix_measure_events_measure", "measure_id", "created_at"),)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String, unique=True, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)
    report_id: Mapped[str | None] = mapped_column(String, nullable=True)
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)     # the validated report the user attached
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.session_id"))
    author: Mapped[str] = mapped_column(String)               # user / assistant
    content: Mapped[str] = mapped_column(Text)
    cards_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    fallback_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (Index("ix_chat_messages_session", "session_id", "created_at"),)


class RiskSnapshot(Base):
    __tablename__ = "risk_snapshots"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_kind: Mapped[str] = mapped_column(String)
    region_key: Mapped[str] = mapped_column(String)
    base_index: Mapped[float] = mapped_column(Float)
    adjusted_index: Mapped[float] = mapped_column(Float)
    implementation_pct: Mapped[float] = mapped_column(Float)
    verified_pct: Mapped[float] = mapped_column(Float)
    cause_measure_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (Index("ix_risk_snapshots_region", "region_kind", "region_key", "created_at"),)


class Account(Base):
    """Self-service WAYMARK account with its selected workspace role."""
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # normalized email
    name: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="community", server_default="community", nullable=False)


OPS_TABLES = [Report.__table__, Measure.__table__, MeasureCell.__table__, Evidence.__table__,
              MeasureEvent.__table__, ChatSession.__table__, ChatMessage.__table__, RiskSnapshot.__table__,
              Account.__table__]


def create_ops_tables(engine: Engine) -> None:
    """Create missing operations tables and add the account role column for existing installs."""
    Base.metadata.create_all(engine, tables=OPS_TABLES, checkfirst=True)
    account_columns = {column["name"] for column in inspect(engine).get_columns("accounts")}
    if "role" not in account_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql("ALTER TABLE accounts ADD COLUMN role VARCHAR NOT NULL DEFAULT 'community'")
