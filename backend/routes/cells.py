from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..measures_service import cell_overlay, overlay_fields
from ..models import Cell, CellScenario, CellShap, Crash
from ..schemas import AUDIT_BANNER, CellDetail, CellLite, CellList, ScenarioItem, ShapItem
from ..services import (FEATURE_LABELS, confidence_explanation, headline_text, maps_url, split_list,
                        top_overall_ids)

router = APIRouter(prefix="/api", tags=["cells"])
CONF = {"high": "High", "medium": "Medium", "low": "Low"}


def parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """bbox = south,west,north,east (latitude/longitude degrees)."""
    try:
        s, w, n, e = (float(x) for x in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be four numbers: south,west,north,east")
    if not (-90 <= s <= n <= 90 and -180 <= w <= e <= 180):
        raise HTTPException(422, "bbox values out of range or in the wrong order (south,west,north,east)")
    return s, w, n, e


@router.get("/cells", response_model=CellList)
def list_cells(min_score: Optional[float] = Query(None, ge=0, le=100),
               max_past_crashes: Optional[int] = Query(None, ge=0),
               confidence: Optional[str] = Query(None, description="High, Medium, Low (comma-separated allowed)"),
               emerging_only: bool = False,
               bbox: Optional[str] = Query(None, description="south,west,north,east"),
               include_locality: bool = False,
               limit: int = Query(10000, ge=1, le=20000), offset: int = Query(0, ge=0),
               db: Session = Depends(get_db)):
    where = []
    if min_score is not None:
        where.append(Cell.risk_score >= min_score)
    if max_past_crashes is not None:
        where.append(Cell.n_past_crashes <= max_past_crashes)
    if confidence:
        labels = []
        for part in confidence.split(","):
            if part.strip().lower() not in CONF:
                raise HTTPException(422, "confidence must be High, Medium or Low")
            labels.append(CONF[part.strip().lower()])
        where.append(Cell.confidence.in_(labels))
    if emerging_only:
        where.append(Cell.emerging_risk == 1)
    if bbox:
        s, w, n, e = parse_bbox(bbox)
        where += [Cell.lat >= s, Cell.lat <= n, Cell.lng >= w, Cell.lng <= e]

    total = db.scalar(select(func.count()).select_from(Cell).where(*where)) or 0
    rows = db.scalars(select(Cell).where(*where)
                      .order_by(Cell.risk_score.desc(), Cell.baseline_prob.desc(), Cell.cell_id)
                      .limit(limit).offset(offset)).all()
    localities: dict[str, str] = {}
    if include_locality and rows:
        cell_ids = [c.cell_id for c in rows]
        for start in range(0, len(cell_ids), 500):
            locality_rows = db.execute(
                select(
                    Crash.cell_id,
                    func.coalesce(func.min(Crash.city), func.min(Crash.street), func.min(Crash.zipcode)),
                )
                .where(Crash.cell_id.in_(cell_ids[start:start + 500]))
                .group_by(Crash.cell_id)
            )
            localities.update({cell_id: name for cell_id, name in locality_rows if name})
    top = top_overall_ids(db)
    credits, briefs = cell_overlay(db)               # additive: cells with measures and their verified credit
    items = [CellLite(cell_id=c.cell_id, locality=localities.get(c.cell_id), lat=c.lat, lng=c.lng, n_past_crashes=c.n_past_crashes,
                      risk_score=c.risk_score, risk_vs_similar_history=c.risk_vs_similar_history,
                      confidence=c.confidence, emerging_risk=bool(c.emerging_risk),
                      top_overall=c.cell_id in top,
                      adjusted_risk_score=overlay_fields(c.risk_score, credits.get(c.cell_id, 0.0)),
                      has_measures=c.cell_id in briefs, measures=briefs.get(c.cell_id, [])) for c in rows]
    return CellList(total=total, count=len(items), limit=limit, offset=offset, items=items)


@router.get("/cells/{cell_id}", response_model=CellDetail)
def cell_detail(cell_id: str, db: Session = Depends(get_db)):
    c = db.get(Cell, cell_id)
    if c is None:
        raise HTTPException(404, f"Cell {cell_id} not found")
    shap_rows = db.scalars(select(CellShap).where(CellShap.cell_id == cell_id).order_by(CellShap.rank)).all()
    scen = db.scalars(select(CellScenario).where(CellScenario.cell_id == cell_id)
                      .order_by(CellScenario.night, CellScenario.rain, CellScenario.low_vis)).all()
    is_top = cell_id in top_overall_ids(db)
    audit = bool(c.emerging_risk) or is_top
    credits, briefs = cell_overlay(db, [cell_id])
    return CellDetail(
        cell_id=c.cell_id, lat=c.lat, lng=c.lng, n_past_crashes=c.n_past_crashes, risk_score=c.risk_score,
        risk_vs_similar_history=c.risk_vs_similar_history, history_percentile=c.history_percentile,
        headline=headline_text(c.risk_vs_similar_history), confidence=c.confidence,
        confidence_explanation=confidence_explanation(c.confidence, c.n_past_crashes),
        emerging_risk=bool(c.emerging_risk), top_overall=is_top, recommend_audit=audit,
        audit_banner=AUDIT_BANNER if audit else None, baseline_prob=c.baseline_prob,
        top_factors=split_list(c.top_factors, ","), suggested_actions=split_list(c.recommendations, "|"),
        shap=[ShapItem(feature=s.feature, label=FEATURE_LABELS.get(s.feature, s.feature),
                       feature_value=s.feature_value, shap_value=s.shap_value,
                       direction="raises" if s.shap_value > 0 else "lowers", rank=s.rank) for s in shap_rows],
        shap_available=bool(shap_rows),
        scenarios=[ScenarioItem(night=bool(s.night), rain=bool(s.rain), low_vis=bool(s.low_vis),
                                probability=s.probability) for s in scen],
        google_maps_url=maps_url(c.lat, c.lng),
        adjusted_risk_score=overlay_fields(c.risk_score, credits.get(cell_id, 0.0)),
        has_measures=cell_id in briefs, measures=briefs.get(cell_id, []))
