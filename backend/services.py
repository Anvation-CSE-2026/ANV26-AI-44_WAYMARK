"""Shared helpers: text formatting and metric parsing. Everything numeric comes from the database."""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Cell, Metric
from .schemas import MetricGroup, MetricPair

TOP_N = 300                       # "top-scoring overall" markers (same N as the export)
LOW_HISTORY_MAX = 2               # same definition as the pipeline
YOY_JUMP_RATIO = 1.5              # same threshold as pipeline/validate_data.py

FEATURE_LABELS = {
    "n_acc": "Past crashes in this cell", "n_recent": "Crashes in the last two years",
    "mean_sev": "Average crash severity", "share_night": "Share of crashes at night",
    "share_rain": "Share of crashes in rain", "mean_vis": "Average visibility (miles)",
    "nb_acc": "Crashes in neighbouring cells", "Junction": "Junction nearby", "Crossing": "Pedestrian crossing nearby",
    "Traffic_Signal": "Traffic signal nearby", "Stop": "Stop sign nearby", "Give_Way": "Give-way sign nearby",
    "Railway": "Railway crossing nearby", "Roundabout": "Roundabout nearby", "Bump": "Speed bump nearby",
    "Traffic_Calming": "Traffic calming nearby", "Station": "Station nearby", "Amenity": "Amenity nearby",
}


def split_list(value: Optional[str], sep: str) -> list[str]:
    return [p.strip() for p in (value or "").split(sep) if p.strip() and p.strip() != "none dominant"]


def maps_url(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={lat:.6f},{lng:.6f}"


def headline_text(pct: Optional[float]) -> str:
    if pct is None:
        return "Comparison with similar-history cells is not available"
    return f"Riskier than {pct:.0f}% of cells with similar history"


def confidence_explanation(label: Optional[str], n: int) -> str:
    crashes = f"{n} past crash{'es' if n != 1 else ''}"
    if label == "High":
        return f"High confidence: {crashes} give the model a solid history, and its repeated runs agreed closely."
    if label == "Medium":
        return (f"Medium confidence: {crashes} give moderate history, or the model's repeated runs "
                f"disagreed somewhat.")
    return (f"Low confidence: this cell has {crashes} on record. Cells with fewer than 3 are always Low, and "
            f"cells where the model's repeated runs disagreed most are lowered one level. Treat this as a "
            f"prompt for expert review, not a finding.")


def top_overall_ids(db: Session) -> set[str]:
    q = select(Cell.cell_id).order_by(Cell.risk_score.desc(), Cell.baseline_prob.desc()).limit(TOP_N)
    return set(db.scalars(q))


def _loads(s: Optional[str]) -> dict:
    try:
        return json.loads(s) if s else {}
    except ValueError:
        return {}


def metric_groups(db: Session) -> dict[str, MetricGroup]:
    """Group the metrics table by group_name. `history_fair` comes from the tie-averaged value in extra_json."""
    groups: dict[str, dict] = defaultdict(lambda: {"metrics": {}, "extra": {}})
    for m in db.scalars(select(Metric).order_by(Metric.id)):
        extra = _loads(m.extra_json)
        g = groups[m.group_name]
        fair = extra.get("history_capture_top10_tie_avg") if m.metric_name == "capture_top10" else None
        if m.group_name == "bootstrap_low_history":
            g["extra"] = extra
            fair = (extra.get("history") or {}).get("point")
        else:
            g["extra"].update({k: v for k, v in extra.items() if k != "history_capture_top10_tie_avg"})
        g["metrics"][m.metric_name] = MetricPair(model=m.model_value, history=m.history_value, history_fair=fair)
    return {k: MetricGroup(group_name=k, **v) for k, v in groups.items()}
