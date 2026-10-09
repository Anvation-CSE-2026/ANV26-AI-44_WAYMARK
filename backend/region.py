"""Region resolution and cell selection helpers."""
from __future__ import annotations

from collections.abc import Iterable

import h3
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Cell, Crash


def cells_for_region(db: Session, region_id: str) -> list[Cell]:
    cells = list(db.scalars(select(Cell).order_by(Cell.risk_score.desc(), Cell.cell_id)))
    if not region_id:
        return []
    exact = {c.cell_id for c in cells if c.cell_id == region_id}
    if exact:
        return [c for c in cells if c.cell_id in exact]
    try:
        resolution = h3.get_resolution(region_id)
        return [c for c in cells if h3.cell_to_parent(c.cell_id, resolution) == region_id]
    except (ValueError, TypeError):
        pass
    pattern = f"%{region_id}%"
    crash_cells = set(db.scalars(select(Crash.cell_id).where(
        (Crash.city.ilike(pattern)) | (Crash.county.ilike(pattern)) | (Crash.zipcode.ilike(pattern))
    )))
    return [c for c in cells if c.cell_id in crash_cells]


def region_label(db: Session, region_id: str) -> tuple[str, str]:
    try:
        resolution = h3.get_resolution(region_id)
        return region_id, f"H3 region {region_id} (resolution {resolution})"
    except (ValueError, TypeError):
        row = db.execute(select(Crash.county, Crash.city).where(
            (Crash.county.ilike(region_id)) | (Crash.city.ilike(region_id))
        ).limit(1)).first()
        if row:
            return region_id, row[0] or row[1] or region_id
        return region_id, region_id


def bbox_for_cells(cells: Iterable[Cell]) -> tuple[float, float, float, float]:
    values = list(cells)
    if not values:
        return 0.0, 0.0, 0.0, 0.0
    return min(c.lat for c in values), min(c.lng for c in values), max(c.lat for c in values), max(c.lng for c in values)
