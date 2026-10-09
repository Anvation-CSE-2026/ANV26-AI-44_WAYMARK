"""Region resolution and analysis.

A region is a set of scored cells. Three kinds:
  h3_parent  key = an H3 cell id coarser than the stored cells (what the map's grouped hexagons are)
  locality   key = "Kind:Name" such as "ZIP code:77002" (matched on crash records), or a bare exact name
  bbox       key = "south,west,north,east"

`region_risk_index` is the mean of the member cells' risk_score. That is the same aggregation the map uses when
it groups cells into larger hexagons (mean of the cell values), so a region's number matches what is drawn.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Iterable, Optional

import h3
from fastapi import HTTPException
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from .config import settings
from .localities import find_locality
from .models import Cell, Crash, DataQuality, YearlyCount
from .schemas_ops import (Bounds, HotspotCell, HourCount, PriorityIssue, Region, RegionAnalysis, YearCount)
from .services import maps_url

REGION_KINDS = ("h3_parent", "locality", "bbox")
INDEX_METHOD = "Mean risk score of the cells in the region (the same aggregation the map uses for grouped hexagons)."
TOP_HOTSPOTS = 10
_CHUNK = 500


@dataclass
class ResolvedRegion:
    region: Region
    cell_ids: list[str]


def _chunks(items: list[str], n: int = _CHUNK) -> Iterable[list[str]]:
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _bounds_of(cells: list[Cell]) -> Bounds:
    return Bounds(south=min(c.lat for c in cells), west=min(c.lng for c in cells),
                  north=max(c.lat for c in cells), east=max(c.lng for c in cells))


def _finish(db: Session, kind: str, key: str, name: str, cell_ids: list[str]) -> ResolvedRegion:
    cells = _cells_by_ids(db, cell_ids)
    if not cells:
        raise HTTPException(422, "This region contains no scored cells, so there is nothing to analyse.")
    if len(cells) > settings.max_report_cells:
        raise HTTPException(422, f"This region has {len(cells):,} cells; the limit is {settings.max_report_cells:,}. "
                                 f"Choose a smaller region.")
    region = Region(kind=kind, key=key, name=name, cell_count=len(cells), bounds=_bounds_of(cells))
    return ResolvedRegion(region, sorted(c.cell_id for c in cells))


def _cells_by_ids(db: Session, ids: list[str]) -> list[Cell]:
    out: list[Cell] = []
    for part in _chunks(sorted(set(ids))):
        out.extend(db.scalars(select(Cell).where(Cell.cell_id.in_(part))))
    return out


def resolve_region(db: Session, kind: str, key: str) -> ResolvedRegion:
    key = (key or "").strip()
    if kind not in REGION_KINDS:
        raise HTTPException(422, f"Unknown region kind '{kind}'. Use one of: {', '.join(REGION_KINDS)}.")
    if not key:
        raise HTTPException(422, "A region key is required.")

    if kind == "h3_parent":
        try:
            valid = h3.is_valid_cell(key)
        except Exception:
            valid = False
        if not valid:
            raise HTTPException(404, f"'{key}' is not a valid H3 cell id.")
        res = h3.get_resolution(key)
        ring = h3.cell_to_boundary(key)
        pad = 0.002
        s, n = min(p[0] for p in ring) - pad, max(p[0] for p in ring) + pad
        w, e = min(p[1] for p in ring) - pad, max(p[1] for p in ring) + pad
        rows = db.execute(select(Cell.cell_id).where(Cell.lat >= s, Cell.lat <= n, Cell.lng >= w, Cell.lng <= e)).all()
        members = []
        for (cid,) in rows:
            try:
                if h3.cell_to_parent(cid, res) == key:
                    members.append(cid)
            except Exception:
                continue                     # a cell id that is not valid H3 simply cannot belong to an H3 region
        return _finish(db, kind, key, f"H3 region {key} (resolution {res})", members)

    if kind == "bbox":
        try:
            s, w, n, e = (float(x) for x in key.split(","))
        except ValueError:
            raise HTTPException(422, "A bbox key must be four numbers: south,west,north,east.")
        if not (-90 <= s <= n <= 90 and -180 <= w <= e <= 180):
            raise HTTPException(422, "bbox values are out of range or in the wrong order (south,west,north,east).")
        ids = list(db.scalars(select(Cell.cell_id).where(Cell.lat >= s, Cell.lat <= n, Cell.lng >= w, Cell.lng <= e)))
        return _finish(db, kind, key, f"Area {s:.3f},{w:.3f} to {n:.3f},{e:.3f}", ids)

    # locality
    if not inspect(db.get_bind()).has_table(Crash.__tablename__):
        raise HTTPException(422, "Locality regions need the crash table. Run pipeline/load_crashes.py first.")
    found = find_locality(db, key)
    if found is None:
        raise HTTPException(404, f"No locality named '{key}' was found in the crash records.")
    lkind, lname, group = found
    return _finish(db, kind, key, f"{lkind}: {lname}", sorted(group["cell_ids"]))


# ------------------------------------------------------------------ index
def region_risk_index(cells: Iterable[Cell | float | None]) -> Optional[float]:
    """Mean risk score. Accepts cells or raw scores; cells with no score are skipped. None when nothing is scored."""
    scores = [(c.risk_score if isinstance(c, Cell) else c) for c in cells]
    vals = [float(v) for v in scores if v is not None]
    return math.fsum(vals) / len(vals) if vals else None


def round_index(v: Optional[float]) -> Optional[float]:
    return None if v is None else round(v, 2)


def data_version(cells: list[Cell]) -> str:
    """Hash of everything the analysis depended on, so a later report can tell it is out of date."""
    h = hashlib.sha256()
    for c in sorted(cells, key=lambda c: c.cell_id):
        h.update(f"{c.cell_id}|{c.risk_score}|{c.n_past_crashes}|{c.emerging_risk}\n".encode())
    return h.hexdigest()[:16]


# ------------------------------------------------------------------ analysis
def _has_crashes(db: Session) -> bool:
    return inspect(db.get_bind()).has_table(Crash.__tablename__)


def _crash_aggregates(db: Session, cell_ids: list[str]) -> dict:
    years: dict[int, int] = {}
    hours: dict[int, int] = {h: 0 for h in range(24)}
    total = night = severe = sev_known = night_known = 0
    by_cell_street: dict[str, dict[str, int]] = {}
    for part in _chunks(cell_ids):
        for year, n in db.execute(select(Crash.year, func.count()).where(Crash.cell_id.in_(part), Crash.year.is_not(None))
                                  .group_by(Crash.year)):
            years[int(year)] = years.get(int(year), 0) + int(n)
        for hh, n in db.execute(select(func.substr(Crash.start_time, 12, 2), func.count())
                                .where(Crash.cell_id.in_(part), Crash.start_time.is_not(None))
                                .group_by(func.substr(Crash.start_time, 12, 2))):
            if hh and hh.isdigit() and 0 <= int(hh) <= 23:
                hours[int(hh)] += int(n)
        t, nt, nk, sv, sk = db.execute(select(
            func.count(), func.sum(Crash.night), func.count(Crash.night),
            func.sum(func.iif(Crash.severity >= 3, 1, 0)), func.count(Crash.severity)).where(Crash.cell_id.in_(part))).one()
        total += int(t or 0); night += int(nt or 0); night_known += int(nk or 0)
        severe += int(sv or 0); sev_known += int(sk or 0)
        for cid, street, n in db.execute(select(Crash.cell_id, Crash.street, func.count())
                                         .where(Crash.cell_id.in_(part), Crash.street.is_not(None), Crash.street != "")
                                         .group_by(Crash.cell_id, Crash.street)):
            by_cell_street.setdefault(cid, {})[street] = int(n)
    return {"years": years, "hours": hours, "total": total,
            "night_share": night / night_known if night_known else None,
            "severe_share": severe / sev_known if sev_known else None,
            "streets": by_cell_street}


def _dataset_night_share(db: Session) -> Optional[float]:
    n, k = db.execute(select(func.sum(Crash.night), func.count(Crash.night))).one()
    return (n or 0) / k if k else None


def _complete_years(db: Session) -> Optional[set[int]]:
    """Years with data for all 12 months (from yearly_counts), or None when that table is not available."""
    if not inspect(db.get_bind()).has_table(YearlyCount.__tablename__):
        return None
    rows = db.execute(select(YearlyCount.year, func.count()).where(YearlyCount.crashes > 0).group_by(YearlyCount.year)).all()
    return {int(y) for y, n in rows if n >= 12} if rows else None


def _quality_caveats(db: Session) -> list[str]:
    if not inspect(db.get_bind()).has_table(DataQuality.__tablename__):
        return []
    rows = db.execute(select(DataQuality.check_name, DataQuality.status, DataQuality.detail)
                      .where(DataQuality.status.in_(("WARN", "FAIL"))).order_by(DataQuality.check_name)).all()
    return [f"Data-quality {status}: {name}" + (f" ({detail})" if detail else "") for name, status, detail in rows[:4]]


def analyse_region(db: Session, resolved: ResolvedRegion) -> RegionAnalysis:
    cells = _cells_by_ids(db, resolved.cell_ids)
    region = resolved.region
    index = region_risk_index(cells)
    ranked = sorted(cells, key=lambda c: (-(c.risk_score if c.risk_score is not None else -1),
                                          -c.n_past_crashes, c.cell_id))
    has_crashes = _has_crashes(db)
    agg = _crash_aggregates(db, [c.cell_id for c in cells]) if has_crashes else None

    hotspots: list[HotspotCell] = []
    for i, c in enumerate(ranked[:TOP_HOTSPOTS], start=1):
        streets = (agg["streets"].get(c.cell_id) if agg else None) or {}
        locality = max(streets.items(), key=lambda kv: (kv[1], kv[0]))[0] if streets else None
        hotspots.append(HotspotCell(
            cell_id=c.cell_id, rank=i, base_score=c.risk_score, n_past_crashes=c.n_past_crashes,
            confidence=c.confidence, emerging_risk=bool(c.emerging_risk),
            risk_vs_similar_history=c.risk_vs_similar_history, lat=c.lat, lng=c.lng, locality=locality,
            google_maps_url=maps_url(c.lat, c.lng)))

    emerging = [c for c in cells if c.emerging_risk]
    year_trend = [YearCount(year=y, crashes=n) for y, n in sorted(agg["years"].items())] if agg else []
    hour_of_day = [HourCount(hour=h, crashes=n) for h, n in sorted(agg["hours"].items())] if agg else []

    caveats = [
        "Risk scores are model estimates built from historical crash records. They are not predictions of future crashes.",
        "The region index is the mean of the cells' risk scores; it describes the region as a whole, not any one road.",
    ]
    if not has_crashes:
        caveats.append("Crash records are not loaded in this database, so the trend, hour-of-day and street details are "
                       "unavailable. Run pipeline/load_crashes.py to enable them.")
    low_conf = sum(1 for c in cells if c.confidence == "Low")
    if cells and low_conf / len(cells) >= 0.5:
        caveats.append(f"{low_conf} of {len(cells)} cells have Low confidence (few past crashes); treat their scores "
                       f"as prompts for expert review.")
    caveats += _quality_caveats(db)

    issues = _priority_issues(db, cells, ranked, emerging, agg, caveats)
    return RegionAnalysis(
        region=region, risk_index=round_index(index), risk_index_method=INDEX_METHOD,
        total_crashes=agg["total"] if agg else None, emerging_cells=len(emerging),
        night_share=None if not agg or agg["night_share"] is None else round(agg["night_share"], 4),
        severe_share=None if not agg or agg["severe_share"] is None else round(agg["severe_share"], 4),
        hotspots=hotspots, year_trend=year_trend, hour_of_day=hour_of_day,
        priority_issues=issues, caveats=caveats)


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def _priority_issues(db: Session, cells: list[Cell], ranked: list[Cell], emerging: list[Cell],
                     agg: Optional[dict], caveats: list[str]) -> list[PriorityIssue]:
    """Issues are derived only from numbers computed above. If the data is missing, the issue is not raised."""
    issues: list[PriorityIssue] = []
    total_past = sum(c.n_past_crashes for c in cells)

    top = ranked[:TOP_HOTSPOTS]
    top_past = sum(c.n_past_crashes for c in top)
    if total_past > 0 and len(cells) > TOP_HOTSPOTS and top_past / total_past >= 0.25:
        issues.append(PriorityIssue(
            id="concentration", title="Crash history is concentrated in a few cells",
            evidence=[f"The {len(top)} highest-scoring cells hold {top_past:,} of the region's {total_past:,} past "
                      f"crashes ({_pct(top_past / total_past)}) while being {_pct(len(top) / len(cells))} of its cells."],
            cell_ids=[c.cell_id for c in top], category="site_safety_audit"))

    if emerging:
        em_top = sorted(emerging, key=lambda c: (-(c.risk_vs_similar_history or 0), c.cell_id))[:TOP_HOTSPOTS]
        issues.append(PriorityIssue(
            id="emerging_risk", title="Emerging-risk cells with little crash history",
            evidence=[f"{len(emerging)} of {len(cells)} cells are flagged as emerging risk: they score high for cells "
                      f"with similar history, and have {min(c.n_past_crashes for c in emerging)} to "
                      f"{max(c.n_past_crashes for c in emerging)} past crashes each."],
            cell_ids=[c.cell_id for c in em_top], category="site_safety_audit"))

    if agg:
        ref = _dataset_night_share(db)
        ns = agg["night_share"]
        if ns is not None and ref is not None and agg["total"] >= 30 and ns >= ref * 1.25:
            night_cells = [c.cell_id for c in ranked[:TOP_HOTSPOTS]]
            issues.append(PriorityIssue(
                id="night_crashes", title="More night-time crashes than the dataset overall",
                evidence=[f"{_pct(ns)} of the region's {agg['total']:,} crashes happened at night, against "
                          f"{_pct(ref)} across the whole dataset."],
                cell_ids=night_cells, category="street_lighting"))
        sv = agg["severe_share"]
        if sv is not None and agg["total"] >= 30 and sv >= 0.2:
            issues.append(PriorityIssue(
                id="severity", title="A notable share of crashes were severity 3 or higher",
                evidence=[f"{_pct(sv)} of the region's recorded crashes have severity 3 or higher (scale 1 to 4)."],
                cell_ids=[c.cell_id for c in ranked[:TOP_HOTSPOTS]], category="speed_management"))
        complete = _complete_years(db)
        years = [(y, n) for y, n in sorted(agg["years"].items()) if complete is None or y in complete]
        if len(years) >= 2:
            (y1, n1), (y2, n2) = years[-2], years[-1]       # the last two COMPLETE years (partial years are skipped)
            if y2 == y1 + 1 and n1 >= 20 and n2 >= n1 * 1.25:
                issues.append(PriorityIssue(
                    id="rising_trend", title="Crash counts rose between the last two full years",
                    evidence=[f"{n2:,} crashes recorded in {y2} against {n1:,} in {y1} (+{_pct(n2 / n1 - 1)})."],
                    cell_ids=[c.cell_id for c in ranked[:TOP_HOTSPOTS]], category="site_safety_audit"))
                caveats.append("Year-to-year changes can reflect changes in how crashes were recorded; check the "
                               "Data quality page before reading a trend as real.")
    return issues
