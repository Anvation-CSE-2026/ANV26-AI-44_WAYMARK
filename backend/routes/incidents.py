"""Role-scoped crash and near-miss reports, kept separate from historical model inputs."""
from __future__ import annotations

from datetime import timezone
from typing import Optional

import h3
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Role, User
from ..db import get_db
from ..models import Cell
from ..models_ops import IncidentReport, utcnow
from ..permissions import require_permission
from ..schemas import IncidentReportIn, IncidentReportList, IncidentReportOut, IncidentReviewIn
from ..ops_common import iso_req
from .cells import parse_bbox

router = APIRouter(prefix="/api", tags=["incidents"])


def _out(row: IncidentReport) -> IncidentReportOut:
    return IncidentReportOut(
        id=row.id, kind=row.kind, cell_id=row.cell_id, lat=row.lat, lng=row.lng,
        occurred_at=iso_req(row.occurred_at), severity=row.severity, reasons=row.reasons, note=row.note,
        status=row.status, review_note=row.review_note,
        created_at=iso_req(row.created_at))


@router.post("/incidents", response_model=IncidentReportOut, status_code=201)
def create_incident(body: IncidentReportIn, db: Session = Depends(get_db),
                    user: User = Depends(require_permission("incident.create"))):
    sample = db.scalar(select(Cell.cell_id).limit(1))
    if sample is None:
        raise HTTPException(503, "Scored cells are not loaded.")
    cell_id = h3.latlng_to_cell(body.lat, body.lng, h3.get_resolution(sample))
    if db.get(Cell, cell_id) is None:
        raise HTTPException(422, "The selected point is outside the scored-cell coverage.")
    occurred = body.occurred_at
    if occurred.tzinfo:
        occurred = occurred.astimezone(timezone.utc).replace(tzinfo=None)
    row = IncidentReport(kind=body.kind, cell_id=cell_id, lat=body.lat, lng=body.lng, occurred_at=occurred,
                         severity=body.severity if body.kind == "crash" else None,
                         reasons=[reason.strip() for reason in (body.reasons or []) if reason.strip()] or None,
                         note=(body.note or "").strip() or None, status="pending", reported_by=user.id,
                         created_at=utcnow(), updated_at=utcnow())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.get("/incidents", response_model=IncidentReportList)
def list_incidents(bbox: Optional[str] = Query(None), cell_id: Optional[str] = Query(None),
                   status: Optional[str] = Query(None, pattern="^(pending|confirmed|rejected)$"),
                   limit: int = Query(3000, ge=1, le=10000), db: Session = Depends(get_db),
                   user: User = Depends(require_permission("incident.read"))):
    if not bbox and not cell_id:
        raise HTTPException(422, "Provide a map bbox or cell id.")
    where = []
    if bbox:
        south, west, north, east = parse_bbox(bbox)
        where += [IncidentReport.lat >= south, IncidentReport.lat <= north,
                  IncidentReport.lng >= west, IncidentReport.lng <= east]
    if cell_id:
        where.append(IncidentReport.cell_id == cell_id)
    if user.role is Role.engineer:
        where.append(IncidentReport.status == "confirmed")
    elif user.role is Role.community:
        where.append((IncidentReport.status == "confirmed") |
                     ((IncidentReport.reported_by == user.id) & (IncidentReport.status != "confirmed")))
    if status:
        where.append(IncidentReport.status == status)
    rows = db.scalars(select(IncidentReport).where(*where)
                      .order_by(IncidentReport.created_at.desc(), IncidentReport.id.desc()).limit(limit)).all()
    return IncidentReportList(count=len(rows), items=[_out(r) for r in rows])


@router.post("/incidents/{incident_id}/review", response_model=IncidentReportOut)
def review_incident(incident_id: int, body: IncidentReviewIn, db: Session = Depends(get_db),
                    user: User = Depends(require_permission("incident.review"))):
    row = db.get(IncidentReport, incident_id)
    if row is None:
        raise HTTPException(404, "Incident report not found.")
    if row.status != "pending":
        raise HTTPException(409, "Only pending incident reports can be reviewed.")
    if row.reported_by == user.id:
        raise HTTPException(403, "You cannot review your own incident report.")
    if body.decision == "reject" and not (body.note or "").strip():
        raise HTTPException(422, "Add a reason when rejecting a report.")
    row.status = "confirmed" if body.decision == "confirm" else "rejected"
    row.reviewed_by = user.id
    row.review_note = (body.note or "").strip() or None
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return _out(row)

