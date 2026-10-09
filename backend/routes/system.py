from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config_loader import get_effects, placeholder_weights
from ..db import get_db
from ..models import Cell
from ..schemas import Headline, Health, Summary
from ..services import LOW_HISTORY_MAX, metric_groups

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=Health)
def health(db: Session = Depends(get_db)):
    return Health(status="ok", database=True, cells=db.scalar(select(func.count()).select_from(Cell)) or 0)


@router.get("/summary", response_model=Summary)
def summary(db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(Cell)) or 0
    low = db.scalar(select(func.count()).select_from(Cell).where(Cell.n_past_crashes <= LOW_HISTORY_MAX)) or 0
    em = db.scalar(select(func.count()).select_from(Cell).where(Cell.emerging_risk == 1)) or 0
    g = metric_groups(db)
    lh, ov = g.get("low_history"), g.get("overall")
    cap = lh.metrics.get("capture_top10") if lh else None
    auc = ov.metrics.get("auc") if ov else None
    return Summary(
        cells_scored=n, low_history_cells=low, emerging_risk_cells=em,
        headline=Headline(
            low_history_capture_top10_model=cap.model if cap else None,
            low_history_capture_top10_history=(cap.history_fair if cap and cap.history_fair is not None
                                               else (cap.history if cap else None)),
            low_history_blackspots=(lh.extra.get("blackspots") if lh else None),
            overall_auc_model=auc.model if auc else None,
            overall_auc_history=auc.history if auc else None,
            scoring_basis=(ov.extra.get("split") if ov else None)),
        placeholder_weights=placeholder_weights(), credit_cap=get_effects().credit_cap)
