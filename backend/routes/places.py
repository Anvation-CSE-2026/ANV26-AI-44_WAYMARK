from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..localities import locality_groups
from ..schemas import PlaceSearchItem, PlaceSearchResponse

router = APIRouter(prefix="/api", tags=["places"])


@router.get("/places", response_model=PlaceSearchResponse)
def search_places(q: str = Query(..., min_length=1, max_length=100), prefix: bool = False,
                  db: Session = Depends(get_db)):
    """Find scored cells containing crashes whose dataset locality matches the query."""
    term = q.strip()
    if len(term) < 1:
        return PlaceSearchResponse(query=q, items=[])

    groups = locality_groups(db, term, prefix=prefix)

    items = []
    for (kind, name), group in groups.items():
        items.append(PlaceSearchItem(
            name=name, kind=kind, crash_count=group["crash_count"],
            cell_ids=sorted(group["cell_ids"]), south=min(group["lats"]), west=min(group["lngs"]),
            north=max(group["lats"]), east=max(group["lngs"]),
        ))
    items.sort(key=lambda item: (0 if item.name.casefold() == term.casefold() else 1,
                                 -item.crash_count, item.kind, item.name))
    return PlaceSearchResponse(query=term, items=items[:20])
