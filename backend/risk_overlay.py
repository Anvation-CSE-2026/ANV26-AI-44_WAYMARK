"""The risk overlay: pure functions, no database access.

The adjusted index is an overlay ESTIMATE, not a re-run of the risk model. Credit comes only from VERIFIED
measures: uploading evidence moves the implementation percentage but never the adjusted score.

  combined_credit = min( 1 - prod(1 - w_i * v_i), credit_cap )      w_i = the measure's effect_weight_snapshot
  adjusted_score  = base * (1 - combined_credit)                    v_i = 1 only when the measure is verified
"""
from __future__ import annotations

import math
from typing import Iterable, Optional, Protocol

from .config_loader import get_effects

EXCLUDED_STATUSES = frozenset({"cancelled", "deleted"})


class MeasureLike(Protocol):
    status: str
    effect_weight_snapshot: float


def stage_factor(status: str) -> float:
    """Share of the way to done for a status, from effects.json. Unknown statuses count as 0."""
    return get_effects().stage_factors.get(status, 0.0)


def _active(measures: Iterable[MeasureLike]) -> list[MeasureLike]:
    return [m for m in measures if m.status not in EXCLUDED_STATUSES]


def implementation_pct(measures: Iterable[MeasureLike]) -> float:
    """Mean stage factor over active measures, times 100. No measures -> 0."""
    ms = _active(measures)
    return math.fsum(stage_factor(m.status) for m in ms) / len(ms) * 100 if ms else 0.0


def verified_pct(measures: Iterable[MeasureLike]) -> float:
    """Share of active measures that are verified, times 100. No measures -> 0."""
    ms = _active(measures)
    return sum(1 for m in ms if m.status == "verified") / len(ms) * 100 if ms else 0.0


def combined_credit(cell_measures: Iterable[MeasureLike], credit_cap: Optional[float] = None) -> float:
    """Multiplicative credit from the verified measures touching one cell, capped at credit_cap."""
    cap = get_effects().credit_cap if credit_cap is None else credit_cap
    remaining = 1.0
    for m in _active(cell_measures):
        if m.status == "verified":
            w = min(max(float(m.effect_weight_snapshot), 0.0), 1.0)    # weight 0 leaves the product unchanged
            remaining *= 1.0 - w
    return min(1.0 - remaining, cap)


def adjusted_score(base: Optional[float], credit: float) -> Optional[float]:
    """base * (1 - credit), clamped to [0, base]."""
    if base is None:
        return None
    credit = min(max(credit, 0.0), 1.0)
    return min(max(base * (1.0 - credit), 0.0), base)


def adjusted_region_index(cells: Iterable[tuple[Optional[float], float]]) -> Optional[float]:
    """Mean of the adjusted scores, using the same aggregation as regions.region_risk_index.

    `cells` is (base_score, combined_credit) per cell; cells without a base score are skipped.
    """
    adjusted = [adjusted_score(base, credit) for base, credit in cells if base is not None]
    vals = [a for a in adjusted if a is not None]
    return math.fsum(vals) / len(vals) if vals else None
