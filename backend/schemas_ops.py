"""Pydantic models for every operations endpoint (reports, measures, evidence, progress, chat).

These are the frozen contracts the frontend mirrors in frontend/src/lib/types.ops.ts. Timestamps are ISO-8601
strings in UTC with a trailing "Z". Changing a field here means updating that file and handoff/FINAL_report.md.
"""
from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field

from .auth import Role

SCHEMA_VERSION = "1"
ESTIMATE_NOTE = ("These are estimates from historical crash records, not predictions. The adjusted index is an "
                 "overlay estimate, not a re-run of the risk model.")


# ------------------------------------------------------------------ auth
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=6, max_length=256)
    role: Role = Role.community


class DemoIn(BaseModel):
    role: Role


class UserOut(BaseModel):
    id: str
    name: str
    role: Role


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ------------------------------------------------------------------ configuration (effects.json)
class CategoryOut(BaseModel):
    id: str
    label: str
    weight: float
    default_owner: Role
    evidence_required: list[str]
    placeholder: bool


class EffectsOut(BaseModel):
    placeholder_weights: bool
    credit_cap: float
    stage_factors: dict[str, float]
    categories: list[CategoryOut]
    note: str = ESTIMATE_NOTE


# ------------------------------------------------------------------ regions and reports
class Bounds(BaseModel):
    south: float
    west: float
    north: float
    east: float


class Region(BaseModel):
    kind: str
    key: str
    name: str
    cell_count: int
    bounds: Bounds


class HotspotCell(BaseModel):
    cell_id: str
    rank: int
    base_score: Optional[float]
    n_past_crashes: int
    confidence: Optional[str]
    emerging_risk: bool
    risk_vs_similar_history: Optional[float]
    lat: float
    lng: float
    locality: Optional[str] = None
    google_maps_url: str = ""


class YearCount(BaseModel):
    year: int
    crashes: int


class HourCount(BaseModel):
    hour: int
    crashes: int


class PriorityIssue(BaseModel):
    id: str
    title: str
    evidence: list[str]
    cell_ids: list[str]
    category: Optional[str] = None       # the effects.json category a measure for this issue would use


class RegionAnalysis(BaseModel):
    region: Region
    risk_index: Optional[float]
    risk_index_method: str
    total_crashes: Optional[int]          # None when the crashes table has not been loaded
    emerging_cells: int
    night_share: Optional[float]
    severe_share: Optional[float]
    hotspots: list[HotspotCell]
    year_trend: list[YearCount]
    hour_of_day: list[HourCount]
    priority_issues: list[PriorityIssue]
    caveats: list[str]


class RegionReport(BaseModel):
    report_id: str
    schema_version: str = SCHEMA_VERSION
    generated_at: str
    data_version: str
    analysis: RegionAnalysis
    placeholder_weights: bool
    disclaimer: str = ESTIMATE_NOTE


class ReportCreate(BaseModel):
    region_kind: str = Field(min_length=1, max_length=32)
    region_key: str = Field(min_length=1, max_length=300)


class ReportSummary(BaseModel):
    report_id: str
    region_kind: str
    region_key: str
    status: Literal["pending", "ready", "failed"]
    created_at: str


class ReportStatus(BaseModel):
    report_id: str
    region_kind: str
    region_key: str
    status: Literal["pending", "ready", "failed"]
    error_safe: Optional[str] = None
    created_at: str
    payload: Optional[RegionReport] = None


# ------------------------------------------------------------------ measures
class MeasureStatus(str, Enum):
    planned = "planned"
    in_progress = "in_progress"
    evidence_submitted = "evidence_submitted"
    verified = "verified"
    cancelled = "cancelled"               # soft-deleted; excluded from both percentages


class EvidenceKind(str, Enum):
    before = "before"
    during = "during"
    after = "after"


class MeasureCreate(BaseModel):
    region_kind: str = Field(min_length=1, max_length=32)
    region_key: str = Field(min_length=1, max_length=300)
    title: str = Field(min_length=3, max_length=200)
    category: str = Field(min_length=1, max_length=64)
    cell_ids: list[str] = Field(min_length=1, max_length=200)
    report_id: Optional[str] = Field(default=None, max_length=64)
    description: Optional[str] = Field(default=None, max_length=4000)
    owner_role: Optional[Role] = None
    source: Literal["chat", "manual"] = "manual"


class MeasurePatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    owner_role: Optional[Role] = None
    status: Optional[MeasureStatus] = None
    note: Optional[str] = Field(default=None, max_length=2000)


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class VerifyRequest(BaseModel):
    decision: Literal["approve", "reject"]
    reason: Optional[str] = Field(default=None, max_length=2000)


class MeasureEvent(BaseModel):
    id: int
    type: str
    from_status: Optional[str]
    to_status: Optional[str]
    actor: str
    actor_role: str
    note: Optional[str]
    created_at: str


Comment = MeasureEvent                    # a comment is a measure event of type "comment"


class Evidence(BaseModel):
    id: int
    measure_id: int
    kind: EvidenceKind
    file_url: str
    thumb_url: str
    caption: Optional[str]
    geo_flag: Literal["ok", "far", "missing"]
    stale_photo: bool
    exif_taken_at: Optional[str]
    uploaded_by: str
    created_at: str


class Measure(BaseModel):
    id: int
    report_id: Optional[str]
    region_kind: str
    region_key: str
    title: str
    category: str
    category_label: str
    description: Optional[str]
    owner_role: Role
    status: MeasureStatus
    effect_weight: float                  # effect_weight_snapshot: the weight copied when the measure was created
    source: str
    created_by: str
    created_at: str
    updated_at: str
    cell_ids: list[str]
    evidence_count: int = 0
    evidence_required: list[str] = []


class MeasureDetail(Measure):
    events: list[MeasureEvent]
    evidence: list[Evidence]
    allowed_next: list[MeasureStatus]


class RiskSnapshotOut(BaseModel):
    created_at: str
    base_index: float
    adjusted_index: float
    implementation_pct: float
    verified_pct: float
    cause_measure_id: Optional[int]


RiskSnapshot = RiskSnapshotOut


class Progress(BaseModel):
    region: Region
    measures: list[Measure]
    implementation_pct: float
    verified_pct: float
    base_index: Optional[float]
    adjusted_index: Optional[float]
    credit_cap: float
    placeholder_weights: bool
    snapshots: list[RiskSnapshotOut]
    note: str = ESTIMATE_NOTE


class CellMeasureBrief(BaseModel):
    """Compact measure shown on map cells (additive field on /api/cells)."""
    id: int
    title: str
    status: str
    category: str
    region_kind: str
    region_key: str


# ------------------------------------------------------------------ chat
class ChatSessionCreate(BaseModel):
    role: Role


class ReportChip(BaseModel):
    report_id: str
    region: Region
    generated_at: str
    stale: bool
    stale_reason: Optional[str] = None


class ChatSessionOut(BaseModel):
    session_id: str
    role: Role
    report: Optional[ReportChip] = None
    created_at: str


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class RecommendationCard(BaseModel):
    card_id: str
    title: str = Field(max_length=200)
    category: str
    owner_role: Role
    cell_ids: list[str]
    rationale: str = Field(max_length=2000)
    evidence_needed: list[str] = []


class ChatMessage(BaseModel):
    id: int
    author: Literal["user", "assistant"]
    content: str
    cards: list[RecommendationCard] = []
    fallback_mode: bool = False
    created_at: str


class ChatHistory(BaseModel):
    session: ChatSessionOut
    messages: list[ChatMessage]


class StartEvent(BaseModel):
    type: Literal["start"] = "start"
    session_id: str


class TokenEvent(BaseModel):
    type: Literal["token"] = "token"
    text: str


class CardEvent(BaseModel):
    type: Literal["card"] = "card"
    card: RecommendationCard


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    message_id: Optional[int] = None
    fallback_mode: bool = False


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


ChatEvent = Annotated[Union[StartEvent, TokenEvent, CardEvent, DoneEvent, ErrorEvent], Field(discriminator="type")]
