"""SQLAlchemy models. They mirror the tables created by pipeline/load_db.py."""
from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Cell(Base):
    __tablename__ = "cells"
    cell_id: Mapped[str] = mapped_column(String, primary_key=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    n_past_crashes: Mapped[int] = mapped_column(Integer)
    risk_score: Mapped[float | None] = mapped_column(Float)
    risk_vs_similar_history: Mapped[float | None] = mapped_column(Float)
    history_percentile: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[str | None] = mapped_column(String)
    top_factors: Mapped[str | None] = mapped_column(Text)
    recommendations: Mapped[str | None] = mapped_column(Text)
    emerging_risk: Mapped[int] = mapped_column(Integer)
    baseline_prob: Mapped[float | None] = mapped_column(Float)


class CellShap(Base):
    __tablename__ = "cell_shap"
    cell_id: Mapped[str] = mapped_column(ForeignKey("cells.cell_id"), primary_key=True)
    rank: Mapped[int] = mapped_column(Integer, primary_key=True)
    feature: Mapped[str] = mapped_column(String)
    feature_value: Mapped[float | None] = mapped_column(Float)
    shap_value: Mapped[float] = mapped_column(Float)


class CellScenario(Base):
    __tablename__ = "cell_scenarios"
    cell_id: Mapped[str] = mapped_column(ForeignKey("cells.cell_id"), primary_key=True)
    night: Mapped[int] = mapped_column(Integer, primary_key=True)
    rain: Mapped[int] = mapped_column(Integer, primary_key=True)
    low_vis: Mapped[int] = mapped_column(Integer, primary_key=True)
    probability: Mapped[float] = mapped_column(Float)


class YearlyCount(Base):
    __tablename__ = "yearly_counts"
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    month: Mapped[int] = mapped_column(Integer, primary_key=True)
    crashes: Mapped[int] = mapped_column(Integer)


class DataQuality(Base):
    __tablename__ = "data_quality"
    check_name: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String)
    detail: Mapped[str | None] = mapped_column(Text)


class Metric(Base):
    __tablename__ = "metrics"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_name: Mapped[str] = mapped_column(String)
    metric_name: Mapped[str] = mapped_column(String)
    model_value: Mapped[float | None] = mapped_column(Float)
    history_value: Mapped[float | None] = mapped_column(Float)
    extra_json: Mapped[str | None] = mapped_column(Text)


class Crash(Base):
    """One real crash from the US Accidents CSV (loaded by pipeline/load_crashes.py)."""
    __tablename__ = "crashes"
    crash_id: Mapped[str] = mapped_column(String, primary_key=True)
    cell_id: Mapped[str] = mapped_column(String, index=True)
    lat: Mapped[float] = mapped_column(Float, index=True)
    lng: Mapped[float] = mapped_column(Float)
    start_time: Mapped[str | None] = mapped_column(String)
    year: Mapped[int | None] = mapped_column(Integer)
    severity: Mapped[int | None] = mapped_column(Integer)
    weather: Mapped[str | None] = mapped_column(String)
    night: Mapped[int | None] = mapped_column(Integer)
    city: Mapped[str | None] = mapped_column(String, index=True)
    county: Mapped[str | None] = mapped_column(String, index=True)
    zipcode: Mapped[str | None] = mapped_column(String, index=True)
    street: Mapped[str | None] = mapped_column(String, index=True)
