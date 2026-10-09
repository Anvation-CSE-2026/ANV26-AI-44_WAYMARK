#!/usr/bin/env python3
"""
WAYMARK | pipeline/rebuild_advice.py

Rewrites `top_factors` and `recommendations` so that every factor and action is backed by the cell's own
crash records (see pipeline/advice.py). It uses the SAVED model and features, so it needs neither the raw
US Accidents CSV nor a retrain, and risk scores, metrics and validation numbers are not touched.

The database is updated IN PLACE (the `crashes` table loaded by load_crashes.py is kept; do not use
load_db.py for this, because it deletes the whole file).

Usage (from the project root):
    python pipeline/rebuild_advice.py                 # defaults: --out out --db waymark.db
    python pipeline/rebuild_advice.py --no-backup
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline.advice import apply_advice  # noqa: E402

TOP_N = 300   # same N and ordering as backend/services.py top_overall_ids


def shap_matrix(model, X: pd.DataFrame) -> np.ndarray:
    sv = shap.TreeExplainer(model).shap_values(X)
    sv = sv[1] if isinstance(sv, list) else sv
    sv = np.asarray(sv)
    return sv[:, :, 1] if sv.ndim == 3 else sv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--db", default="waymark.db", type=Path)
    ap.add_argument("--no-backup", action="store_true")
    a = ap.parse_args()

    for p in (a.db, a.out / "model.joblib", a.out / "cell_features.csv"):
        if not p.exists():
            sys.exit(f"Missing {p}")

    eng = create_engine(f"sqlite:///{a.db}")
    cells = pd.read_sql(text("SELECT cell_id, risk_score, baseline_prob, emerging_risk, top_factors, recommendations "
                             "FROM cells ORDER BY cell_id"), eng)
    art = joblib.load(a.out / "model.joblib")
    feats = art["features"]
    X = pd.read_csv(a.out / "cell_features.csv", index_col=0)
    missing = set(cells.cell_id) - set(X.index)
    if missing:
        sys.exit(f"{len(missing)} database cells have no feature row in cell_features.csv")
    X = X.loc[cells.cell_id, feats]

    sv = shap_matrix(art["models"][0], X)          # models[0] is what the pipeline used for top_factors

    # Sanity: the recomputed SHAP must agree with what is stored. Stored factors (from the old logic or from a
    # previous run of this script) must all be features the model pushes UP for that cell. Safe to re-run.
    positive = [{feats[j] for j in np.flatnonzero(sv[i] > 0)} for i in range(len(sv))]
    stored = [set(s_.split(", ")) - {"none dominant", ""} if isinstance(s_, str) else set() for s_ in cells.top_factors]
    match = float(np.mean([s_ <= p_ for s_, p_ in zip(stored, positive)]))
    print(f"Recomputed SHAP is consistent with the stored factors for {match:.1%} of cells.")
    if match < 0.99:
        sys.exit("Refusing to continue: the saved model does not reproduce the stored factors.")

    top = cells.sort_values(["risk_score", "baseline_prob", "cell_id"], ascending=[False, False, True],
                            na_position="last").head(TOP_N)
    # same ordering as the API: score desc, baseline desc, cell_id asc
    audit = (cells.emerging_risk.to_numpy() == 1) | cells.cell_id.isin(set(top.cell_id)).to_numpy()

    new, report = apply_advice(cells[["cell_id"]].copy(), X, sv, feats, audit)
    report["model_consistent_with_stored_factors"] = round(match, 4)
    report["audit_flagged_cells"] = int(audit.sum())

    if not a.no_backup:
        bak = a.db.with_suffix(a.db.suffix + ".before_advice")
        if not bak.exists():
            shutil.copy2(a.db, bak)
            print(f"Backup: {bak}")
    with eng.begin() as con:
        con.execute(text("UPDATE cells SET top_factors = :f, recommendations = :r WHERE cell_id = :c"),
                    [{"c": c, "f": f, "r": r} for c, f, r in zip(new.cell_id, new.top_factors, new.recommendations)])

    # keep the CSV exports consistent with the database
    lookup = new.set_index("cell_id")
    for path, id_col in ((a.out / "cell_scores.csv", "cell"), (a.out / "export" / "cells.csv", "cell_id")):
        if path.exists():
            df = pd.read_csv(path)
            df["top_factors"] = df[id_col].map(lookup.top_factors)
            df["recommendations"] = df[id_col].map(lookup.recommendations)
            df.to_csv(path, index=False)
            print(f"Updated {path}")

    (a.out / "export").mkdir(parents=True, exist_ok=True)
    (a.out / "export" / "advice_report.json").write_text(json.dumps(report, indent=2))

    r = report
    print(f"\nFactors the old logic listed: {r['factors_listed_before']:,}, of which "
          f"{r['share_supported_before']:.1%} had supporting data in the cell's own records.")
    print(f"Factors listed now: {r['factors_listed_after']:,} (all backed by the cell's own records).")
    print(f"Cells with at least one evidence-backed action: {r['cells_with_evidence_backed_action']:,}")
    print(f"Audit-flagged cells with only the honest fallback: {r['cells_with_audit_fallback_only']:,}")
    print(f"Other cells with no action (nothing to recommend): {r['cells_with_no_action']:,}")


if __name__ == "__main__":
    main()
