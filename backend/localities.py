"""Shared locality SQL: crash records whose city, county, ZIP code or street match a search term.

Extracted from routes/places.py so region resolution can reuse it. `search_localities` must keep returning
exactly what places.py returned before the refactor (the existing tests prove it).
"""
from __future__ import annotations

from sqlalchemy import func, literal, select, union_all
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .models import Crash

LOCALITY_KINDS = ("City", "County", "ZIP code", "Street")


def locality_groups(db: Session, term: str, *, prefix: bool = False) -> dict[tuple[str, str], dict]:
    """Aggregate matching crash localities in SQLite instead of transferring each crash row."""
    pattern = f"{term}%" if prefix else f"%{term}%"
    fields = (("City", Crash.city), ("County", Crash.county),
              ("ZIP code", Crash.zipcode), ("Street", Crash.street))
    statements = []
    for kind, column in fields:
        # NOCASE matches the existing case-insensitive behavior and lets prefix
        # lookups use the locality indexes created during startup.
        predicate = column.collate("NOCASE").like(pattern) if prefix else column.ilike(pattern)
        statements.append(
            select(
                literal(kind).label("kind"), column.label("name"),
                func.count().label("crash_count"),
                func.group_concat(func.distinct(Crash.cell_id)).label("cell_ids"),
                func.min(Crash.lat).label("south"), func.min(Crash.lng).label("west"),
                func.max(Crash.lat).label("north"), func.max(Crash.lng).label("east"),
            )
            .where(column.is_not(None), column != "", predicate)
            .group_by(column)
        )

    groups: dict[tuple[str, str], dict] = {}
    rows = db.execute(union_all(*statements))
    for kind, raw_name, count, cell_ids, south, west, north, east in rows:
        name = (raw_name or "").strip()
        if not name:
            continue
        key = (kind, name)
        group = groups.setdefault(key, {
            "crash_count": 0, "cell_ids": set(),
            "south": south, "west": west, "north": north, "east": east,
        })
        group["crash_count"] += count
        if cell_ids:
            group["cell_ids"].update(cell_ids.split(","))
        group["south"] = min(group["south"], south)
        group["west"] = min(group["west"], west)
        group["north"] = max(group["north"], north)
        group["east"] = max(group["east"], east)
    return groups


def ensure_locality_indexes(engine: Engine) -> None:
    """Create case-insensitive locality indexes for fast prefix autocomplete."""
    from sqlalchemy import inspect

    if not inspect(engine).has_table(Crash.__tablename__):
        return
    with engine.begin() as connection:
        for column in ("city", "county", "zipcode", "street"):
            connection.exec_driver_sql(
                f"CREATE INDEX IF NOT EXISTS ix_crashes_{column}_nocase "
                f"ON crashes ({column} COLLATE NOCASE)"
            )


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
