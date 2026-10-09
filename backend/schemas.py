"""Pydantic response models (the API contract the frontend relies on)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel

from .schemas_ops import CellMeasureBrief

SCENARIO_LABEL = "Scenario simulation, not a live forecast"
AUDIT_BANNER = "Elevated risk, recommend a site audit"
FOOTER = "WAYMARK is decision support only. Human experts decide. Indicative result: one city, one backtest."


class Health(BaseModel):
    status: str
    database: bool
    cells: int = 0


class CellLite(BaseModel):
    cell_id: str
    locality: Optional[str] = None
    lat: float
    lng: float
    n_past_crashes: int
    risk_score: Optional[float]
    risk_vs_similar_history: Optional[float]
    confidence: Optional[str]
    emerging_risk: bool
    top_overall: bool          # in the top 300 cells by risk score (the "blue" markers)
    # Additive (operations build): overlay estimate. Equal to risk_score until a measure is verified.
    adjusted_risk_score: Optional[float] = None
    has_measures: bool = False
    measures: list[CellMeasureBrief] = []


class CellList(BaseModel):
    total: int
    count: int
    limit: int
    offset: int
    items: list[CellLite]


class ShapItem(BaseModel):
    feature: str
    label: str
    feature_value: Optional[float]
    shap_value: float
    direction: str             # "raises" or "lowers"
    rank: int


class ScenarioItem(BaseModel):
    night: bool
    rain: bool
    low_vis: bool
    probability: float


class CellDetail(BaseModel):
    cell_id: str
    lat: float
    lng: float
    n_past_crashes: int
    risk_score: Optional[float]
    risk_vs_similar_history: Optional[float]
    history_percentile: Optional[float]
    headline: str
    confidence: Optional[str]
    confidence_explanation: str
    emerging_risk: bool
    top_overall: bool
    recommend_audit: bool
    audit_banner: Optional[str]
    baseline_prob: Optional[float]
    top_factors: list[str]
    suggested_actions: list[str]
    shap: list[ShapItem]
    shap_available: bool
    scenarios: list[ScenarioItem]
    google_maps_url: str
    # Additive (operations build)
    adjusted_risk_score: Optional[float] = None
    has_measures: bool = False
    measures: list[CellMeasureBrief] = []


class WhatIfItem(BaseModel):
    cell_id: str
    baseline: float
    scenario: float
    change: float
    emerging_risk: bool


class WhatIfResponse(BaseModel):
    label: str
    night: bool
    rain: bool
    low_vis: bool
    n_cells: int
    n_emerging: int
    mean_change_all: Optional[float]
    mean_change_emerging: Optional[float]
    share_cells_higher: Optional[float]
    items: list[WhatIfItem]


class QualityCheck(BaseModel):
    check_name: str
    status: str
    detail: Optional[str]


class YearTotal(BaseModel):
    year: int
    crashes: int
    months_covered: int
    partial: bool
    ratio_vs_previous: Optional[float]
    jump: bool


class MonthCount(BaseModel):
    year: int
    month: int
    crashes: int


class ValidationResponse(BaseModel):
    counts: dict[str, int]
    checks: list[QualityCheck]
    yearly_totals: list[YearTotal]
    monthly_counts: list[MonthCount]


class MetricPair(BaseModel):
    model: Optional[float]
    history: Optional[float]
    history_fair: Optional[float] = None   # history baseline with ties broken at random (use this for charts)


class MetricGroup(BaseModel):
    group_name: str
    metrics: dict[str, MetricPair]
    extra: dict[str, Any] = {}


class MetricsResponse(BaseModel):
    overall: Optional[MetricGroup]
    low_history: Optional[MetricGroup]
    robustness: list[MetricGroup]
    second_split: list[MetricGroup]
    bootstrap: Optional[dict[str, Any]]
    caveat: str


class Headline(BaseModel):
    low_history_capture_top10_model: Optional[float]
    low_history_capture_top10_history: Optional[float]
    low_history_blackspots: Optional[int]
    overall_auc_model: Optional[float]
    overall_auc_history: Optional[float]
    scoring_basis: Optional[str]


class Summary(BaseModel):
    cells_scored: int
    low_history_cells: int
    emerging_risk_cells: int
    headline: Headline
    footer: str = FOOTER
    # Additive (operations build): lets the public map label the adjusted-risk colour mode honestly.
    placeholder_weights: bool = True
    credit_cap: Optional[float] = None


class AuditItem(BaseModel):
    cell_id: str
    region: str
    locality: Optional[str] = None
    lat: float
    lng: float
    n_past_crashes: int
    risk_vs_similar_history: Optional[float]
    risk_score: Optional[float]
    confidence: Optional[str]
    top_factors: list[str]
    suggested_actions: list[str]
    google_maps_url: str


class AuditResponse(BaseModel):
    total: int
    count: int
    limit: int
    offset: int
    items: list[AuditItem]


class CrashPoint(BaseModel):
    crash_id: str
    cell_id: str
    lat: float
    lng: float
    start_time: Optional[str]
    severity: Optional[int]
    weather: Optional[str]
    night: bool


class CrashList(BaseModel):
    available: bool            # False until pipeline/load_crashes.py has been run
    total: int                 # crashes inside the bbox
    count: int                 # crashes returned
    truncated: bool            # True when total > limit
    items: list[CrashPoint]


class PlaceSearchItem(BaseModel):
    name: str
    kind: str
    crash_count: int
    cell_ids: list[str]
    south: float
    west: float
    north: float
    east: float


class PlaceSearchResponse(BaseModel):
    query: str
    items: list[PlaceSearchItem]
