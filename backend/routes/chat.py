"""Assistant chat: sessions, report attach (JSON / PDF with embedded JSON / PDF with a Report ID), SSE messages, history."""
from __future__ import annotations

import io
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Iterator, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pypdf import PdfReader
from pypdf.errors import PyPdfError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import llm
from ..auth import Role, User
from ..db import get_db
from ..models_ops import ChatMessage as MessageRow, ChatSession as SessionRow, Report, utcnow
from ..ops_common import api_error, iso_req
from ..permissions import require_permission
from ..playbooks import fallback_reply, report_digest, requests_actions, rule_based_cards
from ..reports.builder import ATTACHMENT_NAME
from ..schemas_ops import (SCHEMA_VERSION, CardEvent, ChatHistory, ChatMessage, ChatSessionCreate, ChatSessionOut,
                           DoneEvent, ErrorEvent, MessageIn, RecommendationCard, RegionReport, ReportChip, StartEvent,
                           TokenEvent)

router = APIRouter(prefix="/api", tags=["chat"])
log = logging.getLogger("waymark.chat")
MAX_REPORT_BYTES = 8 * 1024 * 1024
REPORT_ID_RE = re.compile(r"WMK-\d{8}-[0-9A-F]{6}")
NO_REPORT_REPLY = ("Attach a WAYMARK Region Report (the PDF or JSON you downloaded from the Analysis tab) and I can "
                   "suggest measures for it. Until then I cannot give recommendation cards.")
UNREADABLE = ("That file is not a WAYMARK Region Report. Upload the report PDF or JSON that you downloaded from the "
              "Analysis tab.")


# ------------------------------------------------------------------ helpers
def _session(db: Session, session_id: str, user: User) -> SessionRow:
    row = db.scalar(select(SessionRow).where(SessionRow.session_id == session_id))
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Chat session not found.")
    return row


def _report_of(row: SessionRow) -> Optional[RegionReport]:
    if not row.report_json:
        return None
    try:
        return RegionReport.model_validate_json(row.report_json)
    except ValidationError:
        return None


def _parse_time(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return datetime.min


def _latest_ready(db: Session, kind: str, key: str) -> Optional[Report]:
    return db.scalar(select(Report).where(Report.region_kind == kind, Report.region_key == key, Report.status == "ready")
                     .order_by(Report.created_at.desc(), Report.id.desc()).limit(1))


def make_chip(db: Session, report: RegionReport) -> ReportChip:
    a = report.analysis
    stale, reason = False, None
    latest = _latest_ready(db, a.region.kind, a.region.key)
    if latest and latest.report_id != report.report_id and latest.created_at > _parse_time(report.generated_at):
        stale, reason = True, f"A newer report exists for this region ({latest.report_id}). Use the latest report for current numbers."
    elif report.schema_version != SCHEMA_VERSION:
        stale, reason = True, (f"This report uses schema version {report.schema_version}; the server now uses "
                               f"{SCHEMA_VERSION}. It can still be used, but some details may be missing.")
    return ReportChip(report_id=report.report_id, region=a.region, generated_at=report.generated_at, stale=stale,
                      stale_reason=reason)


def _session_out(db: Session, row: SessionRow) -> ChatSessionOut:
    rep = _report_of(row)
    return ChatSessionOut(session_id=row.session_id, role=Role(row.role), report=make_chip(db, rep) if rep else None,
                          created_at=iso_req(row.created_at))


def _message_out(m: MessageRow) -> ChatMessage:
    cards = [RecommendationCard.model_validate(c) for c in json.loads(m.cards_json)] if m.cards_json else []
    return ChatMessage(id=m.id, author=m.author, content=m.content, cards=cards, fallback_mode=bool(m.fallback_mode),
                       created_at=iso_req(m.created_at))


def _check_report_shape(r: RegionReport) -> RegionReport:
    a = r.analysis
    if len(a.hotspots) > 200 or len(a.priority_issues) > 50 or len(a.caveats) > 50 or len(a.year_trend) > 100:
        raise HTTPException(422, UNREADABLE)
    return r


def load_report_file(db: Session, data: bytes) -> RegionReport:
    """JSON report, PDF with the embedded JSON, or PDF whose footer carries a Report ID found in the reports table."""
    head = data.lstrip()[:1]
    if head == b"{":
        try:
            return _check_report_shape(RegionReport.model_validate_json(data))
        except (ValidationError, ValueError):
            raise HTTPException(422, UNREADABLE) from None
    if data[:5] == b"%PDF-":
        try:
            reader = PdfReader(io.BytesIO(data))
            attached = reader.attachments.get(ATTACHMENT_NAME)
            if attached:
                try:
                    return _check_report_shape(RegionReport.model_validate_json(attached[0]))
                except (ValidationError, ValueError):
                    raise HTTPException(422, UNREADABLE) from None
            text = " ".join((p.extract_text() or "") for p in reader.pages[:6])
        except (PyPdfError, ValueError, KeyError, OSError):
            raise HTTPException(422, UNREADABLE) from None
        for rid in dict.fromkeys(REPORT_ID_RE.findall(text)):
            row = db.scalar(select(Report).where(Report.report_id == rid, Report.status == "ready"))
            if row and row.payload_json:
                return RegionReport.model_validate_json(row.payload_json)
        raise HTTPException(422, "I could not find a WAYMARK report in that PDF. Upload the PDF or JSON downloaded from "
                                 "the Analysis tab.")
    raise HTTPException(422, UNREADABLE)


# ------------------------------------------------------------------ endpoints
@router.post("/chat/sessions", response_model=ChatSessionOut, status_code=201)
def create_session(body: ChatSessionCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("chat.use"))):
    row = SessionRow(session_id=str(uuid.uuid4()), user_id=user.id, role=body.role.value, created_at=utcnow())
    db.add(row)
    db.commit()
    return _session_out(db, row)


@router.post("/chat/sessions/{session_id}/report", response_model=ReportChip)
def attach_report(session_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                  user: User = Depends(require_permission("chat.use"))):
    row = _session(db, session_id, user)
    data = file.file.read(MAX_REPORT_BYTES + 1)
    if len(data) > MAX_REPORT_BYTES:
        raise HTTPException(422, "That file is too large to be a WAYMARK report.")
    report = load_report_file(db, data)
    row.report_id, row.report_json = report.report_id, report.model_dump_json()
    db.commit()
    return make_chip(db, report)


@router.post("/chat/sessions/{session_id}/report/latest", response_model=ReportChip)
def use_latest_report(session_id: str, db: Session = Depends(get_db), user: User = Depends(require_permission("chat.use"))):
    """Swap the attached report for the newest ready report of the same region ("use latest report")."""
    row = _session(db, session_id, user)
    current = _report_of(row)
    if current is None:
        raise HTTPException(422, "Attach a report first.")
    latest = _latest_ready(db, current.analysis.region.kind, current.analysis.region.key)
    if latest is None or not latest.payload_json:
        raise HTTPException(404, "There is no newer report for this region.")
    report = RegionReport.model_validate_json(latest.payload_json)
    row.report_id, row.report_json = report.report_id, latest.payload_json
    db.commit()
    return make_chip(db, report)


@router.get("/chat/sessions/{session_id}/messages", response_model=ChatHistory)
def history(session_id: str, db: Session = Depends(get_db), user: User = Depends(require_permission("chat.use"))):
    row = _session(db, session_id, user)
    msgs = db.scalars(select(MessageRow).where(MessageRow.session_id == session_id)
                      .order_by(MessageRow.created_at, MessageRow.id)).all()
    return ChatHistory(session=_session_out(db, row), messages=[_message_out(m) for m in msgs])


def sse(model) -> str:
    return f"event: {model.type}\ndata: {model.model_dump_json()}\n\n"


def _chunks(text: str, size: int = 24) -> Iterator[str]:
    words = re.findall(r"\S+\s*", text)
    buf = ""
    for w in words:
        buf += w
        if len(buf) >= size:
            yield buf
            buf = ""
    if buf:
        yield buf


def run_turn(engine, session_id: str, role: Role, report: Optional[RegionReport], history_pairs: list[tuple[str, str]],
             question: str) -> Iterator[tuple[str, object]]:
    """Core of one assistant turn. Yields ("token", str), ("card", RecommendationCard), then ("done", (text, cards, fallback))."""
    if report is None:
        reply = ("Hi! Attach a WAYMARK Region Report and I can answer questions about its findings."
                 if re.fullmatch(r"(?:hi|hello|hey|good morning|good afternoon|good evening)[!. ]*", question.strip(), re.I)
                 else NO_REPORT_REPLY)
        yield from (("token", c) for c in _chunks(reply))
        yield "done", (reply, [], False)
        return
    digest = report_digest(report)
    text, cards, fallback = "", [], False
    try:
        client = llm.get_client()
        if client is None:
            raise llm.LLMError("no API key configured")
        result = None
        for kind, payload in llm.stream_chat(role=role, digest=digest, history=history_pairs, question=question, client=client):
            if kind == "token":
                text += payload
            else:
                result = payload
        cards = llm.validate_cards(result.raw_cards, digest, role) if result else []
        if not result:
            raise llm.LLMError("the model returned no response")
        if not text.strip():
            if cards:
                text = "I found report-backed actions that may help. Review the cards below before adding them to the plan."
            else:
                raise llm.LLMError("the model returned an empty reply")
        yield from (("token", c) for c in _chunks(text.strip()))
    except llm.LLMError as e:
        log.info("assistant fallback: %s", e)
        fallback = True
        cards = rule_based_cards(report, role) if requests_actions(question) else []
        reply = fallback_reply(report, role, cards, question)
        yield from (("token", c) for c in _chunks(reply))
        text = reply
    for c in cards:
        yield "card", c
    yield "done", (text, cards, fallback)


@router.post("/chat/sessions/{session_id}/messages")
def send_message(session_id: str, body: MessageIn, stream: bool = Query(True, description="false returns one JSON body"),
                 db: Session = Depends(get_db), user: User = Depends(require_permission("chat.use"))):
    row = _session(db, session_id, user)
    role, report = Role(row.role), _report_of(row)
    prior = db.scalars(select(MessageRow).where(MessageRow.session_id == session_id)
                       .order_by(MessageRow.created_at, MessageRow.id)).all()
    history_pairs = [(m.author, m.content) for m in prior]
    db.add(MessageRow(session_id=session_id, author="user", content=body.text.strip(), created_at=utcnow()))
    db.commit()
    engine, question = db.get_bind(), body.text.strip()

    def save(text: str, cards: list[RecommendationCard], fallback: bool) -> ChatMessage:
        with Session(engine) as s:
            m = MessageRow(session_id=session_id, author="assistant", content=text,
                           cards_json=json.dumps([c.model_dump(mode="json") for c in cards]) if cards else None,
                           fallback_mode=fallback, created_at=utcnow())
            s.add(m)
            s.commit()
            return _message_out(m)

    if not stream:
        final = ("", [], False)
        for kind, payload in run_turn(engine, session_id, role, report, history_pairs, question):
            if kind == "done":
                final = payload
        saved = save(*final)
        return {"message": saved.model_dump(mode="json")}

    def events() -> Iterator[str]:
        yield sse(StartEvent(session_id=session_id))
        try:
            final = ("", [], False)
            for kind, payload in run_turn(engine, session_id, role, report, history_pairs, question):
                if kind == "token":
                    yield sse(TokenEvent(text=payload))
                elif kind == "card":
                    yield sse(CardEvent(card=payload))
                else:
                    final = payload
            saved = save(*final)
            yield sse(DoneEvent(message_id=saved.id, fallback_mode=final[2]))
        except Exception:
            log.exception("chat turn failed")
            yield sse(ErrorEvent(message="The assistant ran into a problem. Please try again."))
            yield sse(DoneEvent(message_id=None, fallback_mode=True))

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
