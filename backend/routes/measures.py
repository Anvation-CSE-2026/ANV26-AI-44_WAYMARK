"""Measures: create, edit, move through the status flow, comment, verify; plus region progress and the effects config."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Role, User
from ..config_loader import get_effects, placeholder_weights
from ..db import get_db
from ..measures_service import (add_event, apply_transition, get_measure, record_snapshot, region_progress, to_detail,
                                to_schemas)
from ..models import Cell
from ..models_ops import Measure, MeasureCell, Report, utcnow
from ..ops_common import api_error
from ..permissions import can, require_permission
from ..regions import resolve_region
from ..schemas_ops import (CategoryOut, CommentCreate, EffectsOut, Measure as MeasureOut, MeasureCreate, MeasureDetail,
                           MeasureEvent as EventOut, MeasurePatch, MeasureStatus, Progress, VerifyRequest)
from ..ops_common import iso_req

router = APIRouter(prefix="/api", tags=["measures"])


@router.get("/effects", response_model=EffectsOut)
def effects(user: User = Depends(require_permission("report.read"))):
    """Categories, placeholder weights and the credit cap (read-only view of backend/config/effects.json)."""
    e = get_effects()
    return EffectsOut(
        placeholder_weights=placeholder_weights(), credit_cap=e.credit_cap, stage_factors=e.stage_factors,
        categories=[CategoryOut(id=c.id, label=c.label, weight=c.weight, default_owner=Role(c.default_owner),
                                evidence_required=list(c.evidence_required), placeholder=c.placeholder)
                    for c in e.categories.values()])


@router.get("/regions/{kind}/{key:path}/progress", response_model=Progress)
def progress(kind: str, key: str, db: Session = Depends(get_db),
             user: User = Depends(require_permission("report.read"))):
    return region_progress(db, kind, key)


@router.post("/measures", response_model=MeasureOut, status_code=201)
def create_measure(body: MeasureCreate, db: Session = Depends(get_db),
                   user: User = Depends(require_permission("measure.create"))):
    cat = get_effects().categories.get(body.category)
    if cat is None:
        raise api_error(422, "unknown_category", f"'{body.category}' is not a known measure category.",
                        categories=sorted(get_effects().categories))
    owner = body.owner_role or (Role.engineer if user.role is Role.engineer else Role(cat.default_owner))
    if owner is Role.community:
        raise api_error(422, "invalid_owner", "Measures must be assigned to City Planners or Road Authorities.")
    if user.role is Role.engineer and owner is not Role.engineer:
        raise api_error(403, "forbidden", "Road Authorities can create measures only for their own workspace.")
    region = resolve_region(db, body.region_kind, body.region_key)
    cell_ids = sorted(set(body.cell_ids))
    known = set(db.scalars(select(Cell.cell_id).where(Cell.cell_id.in_(cell_ids))))
    if known != set(cell_ids):
        raise api_error(422, "unknown_cells", "Some cell ids do not exist: " + ", ".join(sorted(set(cell_ids) - known)[:5]))
    outside = sorted(set(cell_ids) - set(region.cell_ids))
    if outside:
        raise api_error(422, "cells_outside_region", "These cells are not in the region: " + ", ".join(outside[:5]))
    if body.report_id and db.scalar(select(Report.id).where(Report.report_id == body.report_id)) is None:
        # A report that was attached to the assistant from a file might not be in this database; keep the link only if known.
        body.report_id = None

    m = Measure(report_id=body.report_id, region_kind=region.region.kind, region_key=region.region.key,
                title=body.title.strip(), category=body.category, description=(body.description or "").strip() or None,
                owner_role=owner.value, status="planned",
                effect_weight_snapshot=cat.weight, source=body.source, created_by=user.id,
                created_at=utcnow(), updated_at=utcnow())
    db.add(m)
    db.flush()
    db.add_all(MeasureCell(measure_id=m.id, cell_id=c) for c in cell_ids)
    add_event(db, m, "created", user, to_status="planned", note=f"Created from {body.source}")
    db.flush()
    record_snapshot(db, m)
    db.commit()
    return to_schemas(db, [m])[0]


@router.get("/measures/{measure_id}", response_model=MeasureDetail)
def read_measure(measure_id: int, db: Session = Depends(get_db),
                 user: User = Depends(require_permission("report.read"))):
    return to_detail(db, get_measure(db, measure_id), user)


@router.patch("/measures/{measure_id}", response_model=MeasureDetail)
def patch_measure(measure_id: int, body: MeasurePatch, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("report.read"))):
    m = get_measure(db, measure_id)
    fields = body.model_dump(exclude_unset=True)
    edits = {k: v for k, v in fields.items() if k in ("title", "description", "owner_role")}
    progress_fields = {k: v for k, v in fields.items() if k in ("due_at", "progress_note")}
    if edits or progress_fields:
        if m.status in ("verified", "cancelled"):
            raise api_error(409, "locked", f"A {m.status} measure can no longer be edited.")
        assigned_owner = m.owner_role == user.role.value
        if not (user.role is Role.planner or (user.role is Role.engineer and assigned_owner)):
            raise api_error(403, "forbidden", "Only a planner or the assigned Road Authority can update this measure.")
        if "title" in edits and edits["title"] is not None:
            m.title = edits["title"].strip()
        if "description" in edits:
            m.description = (edits["description"] or "").strip() or None
        if edits.get("owner_role") is not None:
            if user.role is not Role.planner:
                raise api_error(403, "forbidden", "Only City Planners can reassign a measure.")
            if Role(edits["owner_role"]) is Role.community:
                raise api_error(422, "invalid_owner", "Measures must be assigned to City Planners or Road Authorities.")
            m.owner_role = Role(edits["owner_role"]).value
        if "due_at" in progress_fields:
            value = progress_fields["due_at"]
            m.due_at = value.replace(tzinfo=None) if value and value.tzinfo else value
        if "progress_note" in progress_fields:
            m.progress_note = (progress_fields["progress_note"] or "").strip() or None
        m.updated_at = utcnow()
        labels = sorted(set(edits) | set(progress_fields))
        add_event(db, m, "comment", user, note="Updated: " + ", ".join(labels))
    status = fields.get("status")
    if status is not None:
        target = MeasureStatus(status).value
        if target == "cancelled":
            raise api_error(409, "illegal_transition", "Use DELETE to cancel a measure.", allowed=[])
        apply_transition(db, m, target, user, body.note)
    db.commit()
    return to_detail(db, m, user)


@router.delete("/measures/{measure_id}", response_model=MeasureDetail)
def cancel_measure(measure_id: int, db: Session = Depends(get_db),
                   user: User = Depends(require_permission("report.read"))):
    """Soft delete: the measure is marked cancelled and drops out of both percentages and the adjusted index."""
    m = get_measure(db, measure_id)
    if m.status in ("verified", "cancelled"):
        raise api_error(409, "locked", f"A {m.status} measure cannot be cancelled.")
    if not (user.role is Role.planner or (user.role is Role.engineer and m.owner_role == user.role.value)):
        raise api_error(403, "forbidden", "Only a planner or the assigned Road Authority can cancel this measure.")
    prev = m.status
    m.status, m.updated_at = "cancelled", utcnow()
    add_event(db, m, "transition", user, from_status=prev, to_status="cancelled", note="Cancelled")
    db.flush()
    record_snapshot(db, m)
    db.commit()
    return to_detail(db, m, user)


@router.post("/measures/{measure_id}/comments", response_model=EventOut, status_code=201)
def comment(measure_id: int, body: CommentCreate, db: Session = Depends(get_db),
            user: User = Depends(require_permission("measure.comment"))):
    m = get_measure(db, measure_id)
    ev = add_event(db, m, "comment", user, note=body.text.strip())
    db.commit()
    return EventOut(id=ev.id, type=ev.type, from_status=ev.from_status, to_status=ev.to_status, actor=ev.actor,
                    actor_role=ev.actor_role, note=ev.note, created_at=iso_req(ev.created_at))


@router.post("/measures/{measure_id}/verify", response_model=MeasureDetail)
def verify(measure_id: int, body: VerifyRequest, db: Session = Depends(get_db),
           user: User = Depends(require_permission("measure.verify"))):
    m = get_measure(db, measure_id)
    if body.decision == "reject" and not (body.reason or "").strip():
        raise api_error(422, "reason_required", "Give a reason when rejecting evidence.")
    target = "verified" if body.decision == "approve" else "in_progress"
    apply_transition(db, m, target, user, (body.reason or "").strip() or None)
    db.commit()
    return to_detail(db, m, user)
