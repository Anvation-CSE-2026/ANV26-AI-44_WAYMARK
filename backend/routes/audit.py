import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import or_, select, func
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Cell, Crash
from ..schemas import AuditItem, AuditResponse
from ..services import maps_url, split_list

router = APIRouter(prefix="/api", tags=["audit"])
SORTS = {"risk_vs_similar_history": Cell.risk_vs_similar_history, "risk_score": Cell.risk_score,
         "n_past_crashes": Cell.n_past_crashes, "cell_id": Cell.cell_id, "confidence": Cell.confidence}


@router.get("/audit-list", response_model=AuditResponse)
def audit_list(q: Optional[str] = Query(None, description="search cell id, factors or actions"),
               sort: str = Query("risk_vs_similar_history", pattern="^(" + "|".join(SORTS) + ")$"),
               order: str = Query("desc", pattern="^(asc|desc)$"),
               limit: int = Query(500, ge=1, le=5000), offset: int = Query(0, ge=0),
               format: str = Query("json", pattern="^(json|csv)$"), db: Session = Depends(get_db)):
    where = [Cell.emerging_risk == 1]
    if q:
        like = f"%{q.strip()}%"
        where.append(or_(Cell.cell_id.ilike(like), Cell.top_factors.ilike(like), Cell.recommendations.ilike(like)))
    col = SORTS[sort]
    primary = col.desc() if order == "desc" else col.asc()
    locality = (select(
                    Crash.cell_id,
                    func.coalesce(func.min(Crash.county), func.min(Crash.city)).label("region"),
                    func.coalesce(func.min(Crash.city), func.min(Crash.street), func.min(Crash.zipcode)).label("locality"),
                )
                .group_by(Crash.cell_id).subquery())
    stmt = (select(Cell, locality.c.region, locality.c.locality).outerjoin(locality, locality.c.cell_id == Cell.cell_id)
            .where(*where).order_by(primary, Cell.risk_score.desc(), Cell.cell_id))
    total = db.scalar(select(func.count()).select_from(Cell).where(*where)) or 0
    rows = db.execute(stmt if format == "csv" else stmt.limit(limit).offset(offset)).all()
    items = [AuditItem(cell_id=c.cell_id, region=region or "Unknown", locality=cell_locality, lat=c.lat, lng=c.lng, n_past_crashes=c.n_past_crashes,
                       risk_vs_similar_history=c.risk_vs_similar_history, risk_score=c.risk_score,
                       confidence=c.confidence, top_factors=split_list(c.top_factors, ","),
                       suggested_actions=split_list(c.recommendations, "|"),
                       google_maps_url=maps_url(c.lat, c.lng)) for c, region, cell_locality in rows]
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["cell_id", "region", "locality", "lat", "lng", "past_crashes", "riskier_than_pct_of_similar_history", "risk_score",
                    "confidence", "top_factors", "suggested_actions", "google_maps_url", "note"])
        for i in items:
            w.writerow([i.cell_id, i.region, i.locality or "", i.lat, i.lng, i.n_past_crashes, i.risk_vs_similar_history, i.risk_score,
                        i.confidence, "; ".join(i.top_factors), " | ".join(i.suggested_actions), i.google_maps_url,
                        "Elevated risk, recommend a site audit"])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="waymark_audit_list.csv"'})
    return AuditResponse(total=total, count=len(items), limit=limit, offset=offset, items=items)
