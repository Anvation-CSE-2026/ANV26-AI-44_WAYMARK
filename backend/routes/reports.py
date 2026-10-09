"""Region report endpoints. Generation runs in a background task; the client polls GET /api/reports/{id}."""
from __future__ import annotations

import json
import logging
import re
from time import perf_counter
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from ..auth import User
from ..config import settings
from ..config_loader import placeholder_weights
from ..db import get_db
from ..models_ops import Report, utcnow
from ..ops_common import iso_req
from ..permissions import require_permission
from ..regions import _cells_by_ids, analyse_region, data_version, resolve_region
from ..reports.builder import build_report, new_report_id, payload_text, render_pdf
from ..schemas_ops import SCHEMA_VERSION, RegionReport, ReportCreate, ReportStatus, ReportSummary
from ..storage import delete_object, get_object, put_object, remote_storage_enabled

router = APIRouter(prefix="/api", tags=["reports"])
log = logging.getLogger("waymark.reports")
REPORT_ID_RE = re.compile(r"^WMK-\d{8}-[0-9A-F]{6}$")
GENERIC_FAILURE = "The report could not be generated. Please try again; if it keeps failing, ask an administrator to check the server log."


def _to_status(row: Report) -> ReportStatus:
    payload = None
    if row.payload_json:
        payload = RegionReport.model_validate_json(row.payload_json)
    return ReportStatus(report_id=row.report_id, region_kind=row.region_kind, region_key=row.region_key,
                        status=row.status, error_safe=row.error_safe, created_at=iso_req(row.created_at), payload=payload)


def _get_row(db: Session, report_id: str) -> Report:
    row = db.scalar(select(Report).where(Report.report_id == report_id)) if REPORT_ID_RE.match(report_id) else None
    if row is None:
        raise HTTPException(404, "Report not found.")
    return row


def generate_report(engine: Engine, report_id: str) -> None:
    """Background task: build the payload and PDF, then mark the row ready or failed. Never raises."""
    started = perf_counter()
    with Session(engine) as db:
        row = db.scalar(select(Report).where(Report.report_id == report_id))
        if row is None:
            return
        try:
            stage = perf_counter()
            resolved = resolve_region(db, row.region_kind, row.region_key)
            log.info("report %s: region resolved in %.2fs", report_id, perf_counter() - stage)
            stage = perf_counter()
            analysis = analyse_region(db, resolved)
            version = data_version(_cells_by_ids(db, resolved.cell_ids))
            report = build_report(report_id, analysis, version, placeholder_weights())
            log.info("report %s: analysis built in %.2fs", report_id, perf_counter() - stage)
            # Publish the usable analysis before the PDF renderer runs. The client can
            # show findings as soon as analysis is ready while the download is prepared.
            row.payload_json = payload_text(report)
            row.data_version = version
            row.schema_version = report.schema_version
            db.commit()

            rel = Path("reports") / f"{report_id}.pdf"
            local_pdf = settings.data_dir / rel
            stage = perf_counter()
            render_pdf(report, local_pdf)
            log.info("report %s: PDF rendered in %.2fs", report_id, perf_counter() - stage)
            if remote_storage_enabled():
                stage = perf_counter()
                try:
                    put_object(rel.as_posix(), local_pdf.read_bytes(), "application/pdf")
                finally:
                    local_pdf.unlink(missing_ok=True)
                log.info("report %s: PDF uploaded in %.2fs", report_id, perf_counter() - stage)
            row.pdf_path = rel.as_posix()
            row.status, row.error_safe = "ready", None
        except HTTPException as e:                      # region problems carry a plain-language message already
            row.status = "failed"
            row.error_safe = e.detail if isinstance(e.detail, str) else GENERIC_FAILURE
            log.warning("report %s failed: %s", report_id, e.detail)
        except Exception:                               # full detail goes to the log, never to the client
            row.status, row.error_safe = "failed", GENERIC_FAILURE
            log.exception("report %s failed", report_id)
        db.commit()
        log.info("report %s: finished with status=%s in %.2fs", report_id, row.status, perf_counter() - started)


@router.post("/reports", status_code=202, response_model=ReportStatus)
def create_report(body: ReportCreate, background: BackgroundTasks, db: Session = Depends(get_db),
                  user: User = Depends(require_permission("report.create"))):
    resolve_region(db, body.region_kind, body.region_key)          # unknown / empty / oversized regions fail now
    report_id = new_report_id()
    while db.scalar(select(Report.id).where(Report.report_id == report_id)):
        report_id = new_report_id()
    row = Report(report_id=report_id, region_kind=body.region_kind, region_key=body.region_key.strip(),
                 status="pending", schema_version=SCHEMA_VERSION, created_by=user.id, created_at=utcnow())
    db.add(row)
    db.commit()
    background.add_task(generate_report, db.get_bind(), report_id)
    return _to_status(row)


@router.get("/reports", response_model=list[ReportSummary])
def list_reports(region_kind: str = Query(..., max_length=32), region_key: str = Query(..., max_length=300),
                 db: Session = Depends(get_db), user: User = Depends(require_permission("report.read"))):
    rows = db.scalars(select(Report).where(Report.region_kind == region_kind, Report.region_key == region_key.strip())
                      .order_by(Report.created_at.desc(), Report.id.desc()).limit(50))
    return [ReportSummary(report_id=r.report_id, region_kind=r.region_kind, region_key=r.region_key, status=r.status,
                          created_at=iso_req(r.created_at)) for r in rows]


@router.get("/reports/{report_id}", response_model=ReportStatus)
def get_report(report_id: str, db: Session = Depends(get_db), user: User = Depends(require_permission("report.read"))):
    return _to_status(_get_row(db, report_id))


@router.get("/reports/{report_id}/pdf")
def download_pdf(report_id: str, db: Session = Depends(get_db), user: User = Depends(require_permission("report.read"))):
    row = _get_row(db, report_id)
    if row.status != "ready" or not row.pdf_path:
        raise HTTPException(404, "The PDF for this report is not available.")
    try:
        content = get_object(row.pdf_path)
    except FileNotFoundError:
        raise HTTPException(404, "The PDF for this report is not available.") from None
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{row.report_id}.pdf"',
                             "Cache-Control": "private, max-age=3600"})


@router.get("/reports/{report_id}/json")
def download_json(report_id: str, db: Session = Depends(get_db), user: User = Depends(require_permission("report.read"))):
    row = _get_row(db, report_id)
    if row.status != "ready" or not row.payload_json:
        raise HTTPException(404, "The JSON for this report is not available.")
    json.loads(row.payload_json)                     # fail loudly in tests if the stored text was ever corrupted
    return Response(row.payload_json, media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{row.report_id}.json"'})
