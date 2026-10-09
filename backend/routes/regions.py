from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..regions import resolve_region
from ..schemas_ops import Region

router = APIRouter(prefix="/api", tags=["regions"])


@router.get("/regions/resolve", response_model=Region)
def resolve(kind: str = Query(..., max_length=32), key: str = Query(..., min_length=1, max_length=300),
            db: Session = Depends(get_db)):
    """Pure read: the name, cell count and bounds of a region. Public, like the other map reads."""
    return resolve_region(db, kind, key).region
