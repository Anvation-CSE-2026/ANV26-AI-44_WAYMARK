"""Database side of measures: the state machine, progress numbers and risk snapshots.

The arithmetic lives in risk_overlay.py (pure). Everything here reads or writes rows.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .auth import Role, User
from .config_loader import get_effects, placeholder_weights
from .models import Cell
from .models_ops import Evidence, Measure, MeasureCell, MeasureEvent, RiskSnapshot, utcnow
from .ops_common import api_error, iso, iso_req
from .permissions import can
from .regions import ResolvedRegion, _cells_by_ids, region_risk_index, resolve_region, round_index
from .risk_overlay import (EXCLUDED_STATUSES, adjusted_region_index, adjusted_score, combined_credit,
                           implementation_pct, verified_pct)
from .schemas_ops import (CellMeasureBrief, Evidence as EvidenceOut, Measure as MeasureOut, MeasureDetail,
                          MeasureEvent as EventOut, MeasureStatus, Progress, RiskSnapshotOut)

ALLOWED_NEXT: dict[str, list[str]] = {
    "planned": ["in_progress"],
    "in_progress": ["evidence_submitted"],
    "evidence_submitted": ["verified", "in_progress"],     # in_progress here is the reviewer's "reject"
    "verified": [],
    "cancelled": [],
}


@dataclass
class _Credit:
    status: str
    effect_weight_snapshot: float


# ------------------------------------------------------------------ loading / mapping
def get_measure(db: Session, measure_id: int) -> Measure:
    m = db.get(Measure, measure_id)
    if m is None:
        raise HTTPException(404, "Measure not found.")
    return m


def cell_ids_by_measure(db: Session, measure_ids: Iterable[int]) -> dict[int, list[str]]:
    out: dict[int, list[str]] = defaultdict(list)
    ids = list(measure_ids)
    for i in range(0, len(ids), 500):
        for mid, cid in db.execute(select(MeasureCell.measure_id, MeasureCell.cell_id)
                                   .where(MeasureCell.measure_id.in_(ids[i:i + 500])).order_by(MeasureCell.cell_id)):
            out[mid].append(cid)
    return out


def evidence_counts(db: Session, measure_ids: Iterable[int]) -> dict[int, int]:
    ids = list(measure_ids)
    out: dict[int, int] = {}
    for i in range(0, len(ids), 500):
        for mid, n in db.execute(select(Evidence.measure_id, func.count()).where(Evidence.measure_id.in_(ids[i:i + 500]))
                                 .group_by(Evidence.measure_id)):
            out[mid] = n
    return out


def to_schema(m: Measure, cell_ids: list[str], ev_count: int) -> MeasureOut:
    cats = get_effects().categories
    cat = cats.get(m.category)
    return MeasureOut(
        id=m.id, report_id=m.report_id, region_kind=m.region_kind, region_key=m.region_key, title=m.title,
        category=m.category, category_label=cat.label if cat else m.category, description=m.description,
        owner_role=Role(m.owner_role), status=MeasureStatus(m.status), effect_weight=m.effect_weight_snapshot,
        source=m.source, created_by=m.created_by, created_at=iso_req(m.created_at), updated_at=iso_req(m.updated_at),
        cell_ids=cell_ids, evidence_count=ev_count, evidence_required=list(cat.evidence_required) if cat else [])


def to_schemas(db: Session, measures: list[Measure]) -> list[MeasureOut]:
    ids = [m.id for m in measures]
    cells, counts = cell_ids_by_measure(db, ids), evidence_counts(db, ids)
    return [to_schema(m, cells.get(m.id, []), counts.get(m.id, 0)) for m in measures]


def evidence_to_schema(e: Evidence) -> EvidenceOut:
    return EvidenceOut(id=e.id, measure_id=e.measure_id, kind=e.kind, file_url=f"/api/evidence/{e.id}/file",
                       thumb_url=f"/api/evidence/{e.id}/thumb", caption=e.caption, geo_flag=e.geo_flag,
                       stale_photo=bool(e.stale_photo), exif_taken_at=iso(e.exif_taken_at), uploaded_by=e.uploaded_by,
                       created_at=iso_req(e.created_at))


def allowed_next_for(m: Measure, user: User) -> list[MeasureStatus]:
    out = []
    for to in ALLOWED_NEXT.get(m.status, []):
        if m.status == "evidence_submitted":
            ok = can(user.role, "measure.verify")
        else:
            ok = can(user.role, "measure.transition")
        if ok:
            out.append(MeasureStatus(to))
    return out


def to_detail(db: Session, m: Measure, user: User) -> MeasureDetail:
    cells = cell_ids_by_measure(db, [m.id]).get(m.id, [])
    evid = list(db.scalars(select(Evidence).where(Evidence.measure_id == m.id).order_by(Evidence.created_at, Evidence.id)))
    events = list(db.scalars(select(MeasureEvent).where(MeasureEvent.measure_id == m.id)
                             .order_by(MeasureEvent.created_at, MeasureEvent.id)))
    base = to_schema(m, cells, len(evid))
    return MeasureDetail(
        **base.model_dump(), allowed_next=allowed_next_for(m, user), evidence=[evidence_to_schema(e) for e in evid],
        events=[EventOut(id=e.id, type=e.type, from_status=e.from_status, to_status=e.to_status, actor=e.actor,
                         actor_role=e.actor_role, note=e.note, created_at=iso_req(e.created_at)) for e in events])


# ------------------------------------------------------------------ events and snapshots
def add_event(db: Session, m: Measure, type_: str, user: User, *, from_status: Optional[str] = None,
              to_status: Optional[str] = None, note: Optional[str] = None) -> MeasureEvent:
    ev = MeasureEvent(measure_id=m.id, type=type_, from_status=from_status, to_status=to_status, actor=user.id,
                      actor_role=user.role.value, note=note, created_at=utcnow())
    db.add(ev)
    return ev


def cell_credit_map(db: Session, cell_ids: Iterable[str]) -> dict[str, float]:
    """Combined credit per cell from every VERIFIED, non-cancelled measure that touches it (any region)."""
    ids = list(cell_ids)
    by_cell: dict[str, list[_Credit]] = defaultdict(list)
    for i in range(0, len(ids), 500):
        for cid, status, w in db.execute(
                select(MeasureCell.cell_id, Measure.status, Measure.effect_weight_snapshot)
                .join(Measure, Measure.id == MeasureCell.measure_id)
                .where(MeasureCell.cell_id.in_(ids[i:i + 500]), Measure.status == "verified")):
            by_cell[cid].append(_Credit(status, w))
    return {cid: combined_credit(ms) for cid, ms in by_cell.items()}


def region_numbers(db: Session, resolved: ResolvedRegion) -> dict:
    """base / adjusted index and the two percentages for a region, from the current rows."""
    region = resolved.region
    measures = list(db.scalars(select(Measure).where(Measure.region_kind == region.kind, Measure.region_key == region.key,
                                                     Measure.status.not_in(sorted(EXCLUDED_STATUSES)))))
    cells = _cells_by_ids(db, resolved.cell_ids)
    credit = cell_credit_map(db, resolved.cell_ids)
    base = region_risk_index(cells)
    adjusted = adjusted_region_index((c.risk_score, credit.get(c.cell_id, 0.0)) for c in cells)
    return {"measures": measures, "base": base, "adjusted": adjusted,
            "implementation": implementation_pct(measures), "verified": verified_pct(measures)}


def record_snapshot(db: Session, m: Measure) -> None:
    """Append a risk_snapshots row for the measure's region. Called after every status change."""
    try:
        resolved = resolve_region(db, m.region_kind, m.region_key)
    except HTTPException:
        return                                           # region vanished from the data; skip the snapshot
    n = region_numbers(db, resolved)
    db.add(RiskSnapshot(region_kind=m.region_kind, region_key=m.region_key,
                        base_index=round(n["base"] or 0.0, 2), adjusted_index=round(n["adjusted"] or 0.0, 2),
                        implementation_pct=round(n["implementation"], 1), verified_pct=round(n["verified"], 1),
                        cause_measure_id=m.id, created_at=utcnow()))


def region_progress(db: Session, kind: str, key: str) -> Progress:
    resolved = resolve_region(db, kind, key)
    n = region_numbers(db, resolved)
    snaps = list(db.scalars(select(RiskSnapshot).where(RiskSnapshot.region_kind == resolved.region.kind,
                                                       RiskSnapshot.region_key == resolved.region.key)
                            .order_by(RiskSnapshot.created_at.desc(), RiskSnapshot.id.desc()).limit(100)))[::-1]
    ordered = sorted(n["measures"], key=lambda m: (m.created_at, m.id))
    return Progress(
        region=resolved.region, measures=to_schemas(db, ordered), implementation_pct=round(n["implementation"], 1),
        verified_pct=round(n["verified"], 1), base_index=round_index(n["base"]), adjusted_index=round_index(n["adjusted"]),
        credit_cap=get_effects().credit_cap, placeholder_weights=placeholder_weights(),
        snapshots=[RiskSnapshotOut(created_at=iso_req(s.created_at), base_index=s.base_index,
                                   adjusted_index=s.adjusted_index, implementation_pct=s.implementation_pct,
                                   verified_pct=s.verified_pct, cause_measure_id=s.cause_measure_id) for s in snaps])


# ------------------------------------------------------------------ state machine
def has_evidence(db: Session, measure_id: int, kind: Optional[str] = None) -> bool:
    q = select(func.count()).select_from(Evidence).where(Evidence.measure_id == measure_id)
    if kind:
        q = q.where(Evidence.kind == kind)
    return (db.scalar(q) or 0) > 0


def is_self_verification(db: Session, m: Measure, user: User) -> bool:
    """True when the user created the measure or uploaded any of its evidence."""
    if m.created_by == user.id:
        return True
    return (db.scalar(select(func.count()).select_from(Evidence)
                      .where(Evidence.measure_id == m.id, Evidence.uploaded_by == user.id)) or 0) > 0


def apply_transition(db: Session, m: Measure, to: str, user: User, note: Optional[str] = None, *,
                     auto: bool = False) -> None:
    """Move a measure to `to`, enforcing the transition table, permissions and conditions. Does not commit.

    `auto=True` is used by the evidence upload for in_progress -> evidence_submitted; the uploader's own right to
    upload was already checked, so the manual-transition permission is not required.
    """
    frm = m.status
    allowed = ALLOWED_NEXT.get(frm, [])
    if to not in allowed:
        raise api_error(409, "illegal_transition",
                        f"A measure that is '{frm}' cannot move to '{to}'. "
                        + (f"Allowed next: {', '.join(allowed)}." if allowed else "It is final."), allowed=allowed,
                        current=frm)

    event_type = "transition"
    if frm == "evidence_submitted":
        if not can(user.role, "measure.verify"):
            raise api_error(403, "forbidden", "Only a planner can approve or reject submitted evidence.")
        if is_self_verification(db, m, user):
            raise api_error(403, "self_verification",
                            "You cannot review a measure you created or whose evidence you uploaded. "
                            "Another reviewer needs to do this.")
        if to == "verified":
            if not has_evidence(db, m.id, "after"):
                raise api_error(409, "evidence_required", "Approval needs at least one 'after' photo.")
            event_type = "verify"
        else:
            if not (note or "").strip():
                raise api_error(422, "reason_required", "Give a reason when sending a measure back for more work.")
            event_type = "reject"
    elif not auto and not can(user.role, "measure.transition"):
        raise api_error(403, "forbidden", f"Your role ({user.role.value}) cannot change a measure's status.")
    elif frm == "in_progress" and to == "evidence_submitted" and not auto and not has_evidence(db, m.id):
        raise api_error(409, "evidence_required", "Upload at least one photo before submitting evidence.")

    m.status = to
    m.updated_at = utcnow()
    add_event(db, m, event_type, user, from_status=frm, to_status=to, note=(note or None))
    db.flush()
    record_snapshot(db, m)


# ------------------------------------------------------------------ cells overlay (additive fields on /api/cells)
def cell_overlay(db: Session, cell_ids: Optional[Iterable[str]] = None) -> tuple[dict[str, float], dict[str, list[CellMeasureBrief]]]:
    """(credit per cell, compact measures per cell) for cells with at least one active measure.

    Returns empty maps when the operations tables do not exist (an old database), so /api/cells keeps working.
    """
    try:
        q = (select(MeasureCell.cell_id, Measure.id, Measure.title, Measure.status, Measure.category,
                    Measure.effect_weight_snapshot, Measure.region_kind, Measure.region_key)
             .join(Measure, Measure.id == MeasureCell.measure_id).where(Measure.status.not_in(sorted(EXCLUDED_STATUSES))))
        if cell_ids is not None:
            q = q.where(MeasureCell.cell_id.in_(list(cell_ids)))
        rows = db.execute(q.order_by(Measure.id)).all()
    except OperationalError:
        return {}, {}
    briefs: dict[str, list[CellMeasureBrief]] = defaultdict(list)
    credits: dict[str, list[_Credit]] = defaultdict(list)
    for cid, mid, title, status, category, w, rkind, rkey in rows:
        briefs[cid].append(CellMeasureBrief(id=mid, title=title, status=status, category=category,
                                            region_kind=rkind, region_key=rkey))
        credits[cid].append(_Credit(status, w))
    return {cid: combined_credit(ms) for cid, ms in credits.items()}, dict(briefs)


def overlay_fields(base: Optional[float], credit: float) -> Optional[float]:
    v = adjusted_score(base, credit)
    return None if v is None else round(v, 2)
