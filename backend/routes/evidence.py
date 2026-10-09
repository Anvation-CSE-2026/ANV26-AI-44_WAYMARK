"""Evidence photo upload and authenticated download. Uploading never changes the adjusted risk (only verification does)."""
from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import Role, User
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
from ..storage import delete_object, get_object, put_object

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
    if user.role is not Role.planner and not (user.role is Role.engineer and m.owner_role == Role.engineer.value):
        raise api_error(403, "wrong_measure_owner", "Only the assigned workspace can upload measure evidence.")
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
    file_name, thumb_name = f"{stem}.jpg", f"{stem}_thumb.jpg"
    object_keys = [f"evidence/{m.id}/{file_name}", f"evidence/{m.id}/{thumb_name}"]
    try:
        put_object(object_keys[0], processed.image_jpeg, "image/jpeg")
        put_object(object_keys[1], processed.thumb_jpeg, "image/jpeg")
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
        _delete_uploaded(object_keys)
        raise api_error(409, "duplicate_evidence", "This exact photo was already uploaded for this measure.")
    except Exception:
        db.rollback()
        _delete_uploaded(object_keys)
        raise
    return evidence_to_schema(row)


def _delete_uploaded(keys: list[str]) -> None:
    for key in keys:
        try:
            delete_object(key)
        except Exception:
            log.warning("Could not clean up evidence object after a failed upload.")


def _evidence_object(db: Session, evidence_id: int, thumb: bool) -> tuple[str, EvidenceRow]:
    row = db.get(EvidenceRow, evidence_id)
    if row is None:
        raise HTTPException(404, "Evidence not found.")
    name = row.thumb_name if thumb else row.file_name
    return f"evidence/{row.measure_id}/{name}", row


@router.get("/evidence/{evidence_id}/file")
def evidence_file(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("evidence.read"))):
    key, _ = _evidence_object(db, evidence_id, thumb=False)
    try:
        content = get_object(key)
    except FileNotFoundError:
        raise HTTPException(404, "The photo file is missing on the server.") from None
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/evidence/{evidence_id}/thumb")
def evidence_thumb(evidence_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("evidence.read"))):
    key, _ = _evidence_object(db, evidence_id, thumb=True)
    try:
        content = get_object(key)
    except FileNotFoundError:
        raise HTTPException(404, "The photo file is missing on the server.") from None
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
