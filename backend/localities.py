"""Shared locality SQL: crash records whose city, county, ZIP code or street match a search term.

Extracted from routes/places.py so region resolution can reuse it. `search_localities` must keep returning
exactly what places.py returned before the refactor (the existing tests prove it).
"""
from __future__ import annotations

from collections import defaultdict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Crash

LOCALITY_KINDS = ("City", "County", "ZIP code", "Street")


def locality_groups(db: Session, term: str, *, prefix: bool = False) -> dict[tuple[str, str], dict]:
    """Group matching crashes by (kind, value). Each group has crash_count, cell_ids (set), lats, lngs."""
    pattern = f"{term}%" if prefix else f"%{term}%"
    rows = db.execute(
        select(Crash.cell_id, Crash.lat, Crash.lng, Crash.city, Crash.county, Crash.zipcode, Crash.street)
        .where(or_(Crash.city.ilike(pattern), Crash.county.ilike(pattern),
                   Crash.zipcode.ilike(pattern), Crash.street.ilike(pattern)))
    ).all()

    groups: dict[tuple[str, str], dict] = defaultdict(lambda: {
        "crash_count": 0, "cell_ids": set(), "lats": [], "lngs": []
    })
    for cell_id, lat, lng, city, county, zipcode, street in rows:
        fields = (("City", city), ("County", county), ("ZIP code", zipcode), ("Street", street))
        for kind, raw_value in fields:
            value = (raw_value or "").strip()
            matches = value.casefold().startswith(term.casefold()) if prefix else term.casefold() in value.casefold()
            if value and matches:
                group = groups[(kind, value)]
                group["crash_count"] += 1
                group["cell_ids"].add(cell_id)
                group["lats"].append(lat)
                group["lngs"].append(lng)
    return groups


def find_locality(db: Session, key: str) -> tuple[str, str, dict] | None:
    """Resolve a region key: "Kind:Name" (for example "ZIP code:77002") or a bare name matched exactly.

    Returns (kind, name, group) for the best exact match (most crashes), or None.
    """
    kind_filter = None
    name = key.strip()
    if ":" in name:
        head, _, tail = name.partition(":")
        if head.strip() in LOCALITY_KINDS:
            kind_filter, name = head.strip(), tail.strip()
    if len(name) < 2:
        return None
    best = None
    for (kind, value), group in locality_groups(db, name).items():
        if value.casefold() != name.casefold() or (kind_filter and kind != kind_filter):
            continue
        if best is None or group["crash_count"] > best[2]["crash_count"]:
            best = (kind, value, group)
    return best
