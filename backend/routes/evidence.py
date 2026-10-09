"""Evidence photo upload and authenticated download. Uploading never changes the adjusted risk (only verification does)."""
from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import User
from ..config import settings
from ..db import get_db
from ..evidence_service import (BadImage, caption_from_filename, clean_caption, geo_flag, is_stale, process_image,
                                rate_limited, sniff)
from ..measures_service import add_event, apply_transition, evidence_to_schema, get_measure
from ..models import Cell
from ..models_ops import Evidence as EvidenceRow, MeasureCell, utcnow
from ..ops_common import api_error
from ..permissions import require_permission
from ..schemas_ops import Evidence, EvidenceKind

router = APIRouter(prefix="/api", tags=["evidence"])
log = logging.getLogger("waymark.evidence")
CHUNK = 64 * 1024


def evidence_dir(measure_id: int) -> Path:
    return settings.data_dir / "evidence" / str(int(measure_id))


def _read_capped(file: UploadFile) -> bytes:
    """Read the upload in chunks and stop as soon as it passes the size cap."""
    limit = settings.max_upload_mb * 1024 * 1024
    buf = bytearray()
    while True:
        chunk = file.file.read(CHUNK)
        if not chunk:
            return bytes(buf)
        buf += chunk
        if len(buf) > limit:
            raise api_error(413, "too_large", f"That photo is larger than {settings.max_upload_mb} MB. Choose a smaller one.")


@router.post("/measures/{measure_id}/evidence", response_model=Evidence, status_code=201)
def upload_evidence(measure_id: int, request: Request, file: UploadFile = File(...), kind: EvidenceKind = Form(...),
                    caption: str = Form(""), db: Session = Depends(get_db),
                    user: User = Depends(require_permission("evidence.upload"))):
    m = get_measure(db, measure_id)
    if rate_limited(user.id):
        raise api_error(429, "rate_limited", f"Too many uploads. Wait a minute and try again "
                                              f"(limit {settings.upload_rate_per_min} per minute).")
    if m.status in ("verified", "cancelled"):
        raise api_error(409, "locked", f"A {m.status} measure does not accept new evidence.")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_upload_mb * 1024 * 1024 + 64 * 1024:
        raise api_error(413, "too_large", f"That photo is larger than {settings.max_upload_mb} MB. Choose a smaller one.")

    data = _read_capped(file)
    if not data:
        raise api_error(415, "unsupported_type", "The uploaded file is empty.")
    if sniff(data) is None:
        raise api_error(415, "unsupported_type", "Only JPEG, PNG or WebP photos are accepted.")
    digest = hashlib.sha256(data).hexdigest()
    if db.scalar(select(EvidenceRow.id).where(EvidenceRow.measure_id == m.id, EvidenceRow.sha256 == digest)):
        raise api_error(409, "duplicate_evidence", "This exact photo was already uploaded for this measure.")
    try:
        processed = process_image(data)                      # EXIF is read inside, before the re-encode
    except BadImage as e:
        raise api_error(415, "unsupported_type", str(e))

    points = [(lat, lng) for lat, lng in db.execute(
        select(Cell.lat, Cell.lng).join(MeasureCell, MeasureCell.cell_id == Cell.cell_id).where(MeasureCell.measure_id == m.id))]
    flag = geo_flag(processed.gps, points)

    stem = uuid.uuid4().hex
    folder = evidence_dir(m.id)
    folder.mkdir(parents=True, exist_ok=True)
    file_name, thumb_name = f"{stem}.jpg", f"{stem}_thumb.jpg"
    (folder / file_name).write_bytes(processed.image_jpeg)
    (folder / thumb_name).write_bytes(processed.thumb_jpeg)
    try:
        row = EvidenceRow(measure_id=m.id, kind=kind.value, file_name=file_name, thumb_name=thumb_name, sha256=digest,
                          caption=clean_caption(caption) or caption_from_filename(file.filename), exif_taken_at=processed.taken,
                          geo_flag=flag, stale_photo=is_stale(processed.taken), uploaded_by=user.id, created_at=utcnow())
        db.add(row)
        db.flush()
        add_event(db, m, "evidence", user, note=f"{kind.value} photo added ({flag} location)")
        if kind.value == "after" and m.status == "in_progress":
            apply_transition(db, m, "evidence_submitted", user, "Submitted automatically with an 'after' photo", auto=True)
        m.updated_at = utcnow()
        db.commit()
    except IntegrityError:
        db.rollback()
        (folder / file_name).unlink(missing_ok=True)
        (folder / thumb_name).unlink(missing_ok=True)
        raise api_error(409, "duplicate_evidence", "This exact photo was already uploaded for this measure.")
    except Exception:
        db.rollback()
        (folder / file_name).unlink(missing_ok=True)
        (folder / thumb_name).unlink(missing_ok=True)
        raise
    return evidence_to_schema(row)


def _evidence_path(db: Session, evidence_id: int, thumb: bool) -> tuple[Path, EvidenceRow]:
    row = db.get(EvidenceRow, evidence_id)
    if row is None:
        raise HTTPException(404, "Evidence not found.")
    folder = evidence_dir(row.measure_id).resolve()
    path = (folder / (row.thumb_name if thumb else row.file_name)).resolve()
    if folder not in path.parents or not path.is_file():           # the name is server-made; this is belt and braces
        raise HTTPException(404, "The photo file is missing on the server.")
    return path, row


@router.get("/evidence/{evidence_id}/file")
def evidence_file(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("evidence.read"))):
    path, _ = _evidence_path(db, evidence_id, thumb=False)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/evidence/{evidence_id}/thumb")
def evidence_thumb(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("evidence.read"))):
    path, _ = _evidence_path(db, evidence_id, thumb=True)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
