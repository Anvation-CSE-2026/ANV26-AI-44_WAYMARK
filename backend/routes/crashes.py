from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Crash
from ..schemas import CrashList, CrashPoint
from .cells import parse_bbox

router = APIRouter(prefix="/api", tags=["crashes"])


@router.get("/crashes", response_model=CrashList)
def list_crashes(bbox: Optional[str] = Query(None, description="south,west,north,east"),
                 cell_id: Optional[str] = Query(None, description="only crashes inside this H3 cell"),
                 limit: int = Query(3000, ge=1, le=10000),
                 db: Session = Depends(get_db)):
    """Real crash locations (points) for the map. Needs a bbox or a cell_id so the whole table is never sent."""
    if not inspect(db.get_bind()).has_table(Crash.__tablename__):
        return CrashList(available=False, total=0, count=0, truncated=False, items=[])
    where = []
    if bbox:
        s, w, n, e = parse_bbox(bbox)
        where += [Crash.lat >= s, Crash.lat <= n, Crash.lng >= w, Crash.lng <= e]
    if cell_id:
        where.append(Crash.cell_id == cell_id)
    if not where:
        return CrashList(available=True, total=0, count=0, truncated=False, items=[])
    total = db.scalar(select(func.count()).select_from(Crash).where(*where)) or 0
    rows = db.scalars(select(Crash).where(*where).order_by(Crash.start_time.desc(), Crash.crash_id).limit(limit)).all()
    items = [CrashPoint(crash_id=c.crash_id, cell_id=c.cell_id, lat=c.lat, lng=c.lng, start_time=c.start_time,
                        severity=c.severity, weather=c.weather or None, night=bool(c.night)) for c in rows]
    return CrashList(available=True, total=total, count=len(items), truncated=total > len(items), items=items)
