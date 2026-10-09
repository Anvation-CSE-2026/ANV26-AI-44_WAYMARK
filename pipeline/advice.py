"""
WAYMARK | pipeline/advice.py

Evidence-gated risk factors and suggested actions.

Why this exists
---------------
SHAP says which features pushed a cell's score UP relative to the average cell. That is not the same as
"this feature is a problem here": a feature can push the score up because it is ABSENT (for example
Amenity = 0, or no night crashes). Turning every positive SHAP value into advice therefore produced
suggestions such as "improve street lighting" for cells whose own crashes all happened in daylight.

Rule used here
--------------
A factor is listed, and an action is suggested, only when BOTH hold:
  1. the model attributes an upward push to the feature (SHAP > 0), and
  2. the cell's own crash records show the condition (the "evidence gate" below).
Every action carries a one-line "Basis" with the real numbers behind it. Cells that have no
evidence-backed action get no invented one; cells flagged for audit get an honest fallback instead.

These are prompts for a human site audit. They are not diagnoses of cause.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

BASIS_MARK = " Basis: "          # the UI splits the action text from its evidence on this marker
MARGIN = 1.25                     # night / rain share must be at least 1.25x the Houston-wide share
VIS_FACTOR = 0.75                 # visibility must be at most 75% of the Houston-wide average
CLUSTER_QUANTILE = 0.75           # "cluster" = neighbouring crashes in the top quarter of Houston cells
MAX_FACTORS = 3

FLAGS = ["Junction", "Crossing", "Traffic_Signal", "Stop", "Give_Way", "Railway",
         "Roundabout", "Bump", "Traffic_Calming", "Station", "Amenity"]

FLAG_NOUN = {
    "Junction": "junction", "Crossing": "pedestrian crossing", "Traffic_Signal": "traffic signal",
    "Stop": "stop sign", "Give_Way": "give-way sign", "Railway": "railway crossing",
    "Roundabout": "roundabout", "Bump": "speed bump", "Traffic_Calming": "traffic-calming feature",
    "Station": "station", "Amenity": "amenity",
}

AUDIT_ACTION = "Recommend a detailed site safety audit"
ACTIONS = {
    "share_night": "Consider reviewing street lighting and reflective signage",
    "share_rain": "Consider checking drainage and skid resistance of the road surface",
    "mean_vis": "Consider adding low-visibility warnings and road markings",
    "Junction": "Consider reviewing junction layout, sight lines and signage",
    "Crossing": "Consider reviewing pedestrian crossing visibility and provision",
    "Traffic_Signal": "Consider reviewing signal timing and placement",
    "Stop": "Consider reviewing stop-sign visibility and approach speeds",
    "Give_Way": "Consider reviewing give-way markings and approach speeds",
    "Railway": "Consider reviewing level-crossing warnings",
    "Roundabout": "Consider reviewing roundabout approach design",
    "Bump": "Consider checking speed-bump visibility and warnings",
    "Traffic_Calming": "Consider reviewing traffic-calming effectiveness",
    "Station": "Consider managing traffic around the station entrance",
    "Amenity": "Consider managing access and parking near amenities",
    "n_acc": AUDIT_ACTION, "n_recent": AUDIT_ACTION, "mean_sev": AUDIT_ACTION,
    "nb_acc": "Consider auditing the surrounding corridor as a cluster",
}

FALLBACK = ("Recommend a site audit to look for local causes."
            + BASIS_MARK + "this cell scores above most cells with similar history, but no single recorded factor "
            "stands out. A site visit can look at things this crash data does not capture, such as road layout "
            "or traffic volume.")


def reference_stats(f: pd.DataFrame) -> dict:
    """Houston-wide reference values. Rates are weighted by crash count, so they are per-crash, not per-cell."""
    n = f["n_acc"].to_numpy(dtype=float)
    w = lambda col: float((f[col].to_numpy(dtype=float) * n).sum() / n.sum())
    return {
        "night": w("share_night"), "rain": w("share_rain"), "vis": w("mean_vis"),
        "n_acc_median": float(f["n_acc"].median()), "n_recent_median": float(f["n_recent"].median()),
        "sev_median": float(f["mean_sev"].median()), "nb_acc_q": float(f["nb_acc"].quantile(CLUSTER_QUANTILE)),
        "nb_acc_median": float(f["nb_acc"].median()),
    }


def _plural(n: int) -> str:
    return f"{n} past crash" + ("" if n == 1 else "es")


def _of(k: int, n: int) -> str:
    """'the only past crash' / '2 of 5 past crashes' (reads correctly for any count)."""
    return "the only past crash" if n == 1 else f"{k} of {n} past crashes"


def evidence(feat: str, row: dict, ref: dict) -> str | None:
    """Return a one-line basis if the cell's own data show the condition, else None."""
    n = int(round(row["n_acc"]))
    v = float(row[feat])
    if feat in FLAGS:
        k = int(round(v * n))
        if k >= 1:
            return f"a {FLAG_NOUN[feat]} was recorded next to {_of(k, n)}."
    elif feat in ("share_night", "share_rain"):
        k = int(round(v * n))
        r = ref["night"] if feat == "share_night" else ref["rain"]
        what = "happened at night" if feat == "share_night" else "happened in rain"
        if k >= 1 and v >= MARGIN * r:
            return f"{_of(k, n)} ({v:.0%}) {what}, against {r:.0%} across Houston."
    elif feat == "mean_vis":
        if v <= VIS_FACTOR * ref["vis"]:
            return f"average visibility at past crashes was {v:.1f} miles, against {ref['vis']:.1f} miles across Houston."
    elif feat == "n_acc":
        if v > ref["n_acc_median"]:
            return (f"This cell has {_plural(n)}; the median scored Houston cell has "
                f"{ref['n_acc_median']:.0f} past crashes.")
    elif feat == "n_recent":
        if v > ref["n_recent_median"]:
            return (f"This cell has {int(round(v))} crashes in the last two years; the median scored "
                f"Houston cell has {ref['n_recent_median']:.0f}.")
    elif feat == "mean_sev":
        if v > ref["sev_median"]:
            return (f"Average crash severity is {v:.1f}; the median scored Houston cell is "
                f"{ref['sev_median']:.1f}.")
    elif feat == "nb_acc":
        if v >= ref["nb_acc_q"]:
            return (f"{int(round(v))} past crashes in the neighbouring cells, in the top quarter of Houston cells "
                    f"(median {ref['nb_acc_median']:.0f}).")
    return None


def apply_advice(cells: pd.DataFrame, feats_df: pd.DataFrame, sv: np.ndarray, feats: list[str],
                 audit_mask: np.ndarray) -> tuple[pd.DataFrame, dict]:
    """
    cells      : one row per cell, same order as feats_df / sv
    feats_df   : feature matrix (columns include `feats`)
    sv         : SHAP matrix (n_cells x n_features) for the model that produced the scores
    audit_mask : True for cells the app flags for audit (emerging risk or top-scoring); only these get the fallback
    Returns (cells with top_factors and recommendations rewritten, report).
    """
    assert len(cells) == len(feats_df) == len(sv) == len(audit_mask)
    ref = reference_stats(feats_df[feats])
    rows = feats_df[feats].to_dict("records")
    order = np.argsort(-sv, axis=1)

    top_factors, recs = [], []
    raw_listed = raw_supported = kept_total = 0
    cells_with_action = cells_fallback = cells_empty = 0
    for i, row in enumerate(rows):
        raw3, kept = [], []
        for j in order[i]:
            if sv[i, j] <= 0:
                break
            feat = feats[j]
            if len(raw3) < MAX_FACTORS:
                raw3.append(feat)
            b = evidence(feat, row, ref)
            if b is not None and len(kept) < MAX_FACTORS:
                kept.append((feat, b))
            if len(raw3) >= MAX_FACTORS and len(kept) >= MAX_FACTORS:
                break
        raw_listed += len(raw3)
        raw_supported += sum(evidence(f_, row, ref) is not None for f_ in raw3)
        kept_total += len(kept)

        kept.sort(key=lambda t: t[0] == "nb_acc")          # specific actions first, cluster advice last
        thin = int(round(row["n_acc"])) < 3
        actions: dict[str, str] = {}
        for feat, b in kept:
            a = ACTIONS[feat]
            if a not in actions:
                note = (f" This rests on only {_plural(int(round(row['n_acc'])))}."
                        if thin and "only past crash" not in b else "")
                actions[a] = f"{a}.{BASIS_MARK}{b}{note}"
        if actions:
            cells_with_action += 1
        elif audit_mask[i]:
            actions[FALLBACK] = FALLBACK
            cells_fallback += 1
        else:
            cells_empty += 1
        top_factors.append(", ".join(f_ for f_, _ in kept) or "none dominant")
        recs.append(" | ".join(actions.values()))

    out = cells.copy()
    out["top_factors"] = top_factors
    out["recommendations"] = recs
    report = {
        "cells": len(out),
        "reference": {k: round(v, 4) for k, v in ref.items()},
        "factors_listed_before": raw_listed,
        "factors_with_supporting_data_before": raw_supported,
        "share_supported_before": round(raw_supported / raw_listed, 4) if raw_listed else None,
        "factors_listed_after": kept_total,
        "share_supported_after": 1.0 if kept_total else None,
        "cells_with_evidence_backed_action": cells_with_action,
        "cells_with_audit_fallback_only": cells_fallback,
        "cells_with_no_action": cells_empty,
    }
    return out, report
