#!/usr/bin/env python3
"""
WAYMARK | pipeline/load_db.py

Builds waymark.db (SQLite) from the files produced by the earlier steps:
  out/export/cells.csv, cell_shap.csv, cell_scenarios.csv, metrics_rows.csv   (export_results.py)
  out/data_quality.json                                                        (validate_data.py)

Refuses to run when the database already exists unless --force is given (it deletes the
whole file, including measures and evidence rows). Every table is rebuilt, so the database
always matches the files. Nothing is invented here; values are copied as exported.

Usage:
    python pipeline/load_db.py                # defaults: --out out --db waymark.db
    python pipeline/load_db.py --out out --db waymark.db
    python pipeline/load_db.py --force        # only when you really want to delete and rebuild everything
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text

SCHEMA = [
    """CREATE TABLE cells (
        cell_id TEXT PRIMARY KEY,
        lat REAL NOT NULL, lng REAL NOT NULL,
        n_past_crashes INTEGER NOT NULL,
        risk_score REAL, risk_vs_similar_history REAL, history_percentile REAL,
        confidence TEXT CHECK (confidence IN ('High','Medium','Low')),
        top_factors TEXT, recommendations TEXT,
        emerging_risk INTEGER NOT NULL CHECK (emerging_risk IN (0,1)),
        baseline_prob REAL
    )""",
    """CREATE TABLE cell_shap (
        cell_id TEXT NOT NULL REFERENCES cells(cell_id),
        feature TEXT NOT NULL, feature_value REAL, shap_value REAL NOT NULL,
        rank INTEGER NOT NULL,
        PRIMARY KEY (cell_id, rank)
    )""",
    """CREATE TABLE cell_scenarios (
        cell_id TEXT NOT NULL REFERENCES cells(cell_id),
        night INTEGER NOT NULL, rain INTEGER NOT NULL, low_vis INTEGER NOT NULL,
        probability REAL NOT NULL,
        PRIMARY KEY (cell_id, night, rain, low_vis)
    )""",
    """CREATE TABLE yearly_counts (
        year INTEGER NOT NULL, month INTEGER NOT NULL, crashes INTEGER NOT NULL,
        PRIMARY KEY (year, month)
    )""",
    """CREATE TABLE data_quality (
        check_name TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('PASS','WARN','FAIL')),
        detail TEXT
    )""",
    """CREATE TABLE metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_name TEXT NOT NULL, metric_name TEXT NOT NULL,
        model_value REAL, history_value REAL, extra_json TEXT
    )""",
    "CREATE INDEX idx_cells_emerging ON cells(emerging_risk, risk_vs_similar_history DESC)",
    "CREATE INDEX idx_cells_score ON cells(risk_score DESC)",
    "CREATE INDEX idx_cells_geo ON cells(lat, lng)",
    "CREATE INDEX idx_shap_cell ON cell_shap(cell_id)",
]
DROP_ORDER = ["cell_scenarios", "cell_shap", "cells", "yearly_counts", "data_quality", "metrics"]


def need(path: Path) -> Path:
    if not path.exists():
        sys.exit(f"Missing {path}. Run the earlier pipeline step that creates it first.")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out", type=Path)
    ap.add_argument("--db", default="waymark.db", type=Path)
    ap.add_argument("--force", action="store_true",
                    help="allow deleting an existing database (this also deletes measures, evidence rows, "
                         "reports and chat history)")
    a = ap.parse_args()
    if a.db.exists() and not a.force:
        sys.exit(f"{a.db} already exists. Rebuilding it DELETES the whole file, including the crashes table and all "
                 f"measures, evidence rows, reports and chat history.\n"
                 f"Run again with --force if that is what you want. To only refresh the suggested actions, use "
                 f"python pipeline/rebuild_advice.py instead.")
    exp = a.out / "export"

    cells = pd.read_csv(need(exp / "cells.csv"))
    shap_df = pd.read_csv(need(exp / "cell_shap.csv"))
    scen = pd.read_csv(need(exp / "cell_scenarios.csv"))
    metrics = pd.read_csv(need(exp / "metrics_rows.csv"))
    dq = json.load(open(need(a.out / "data_quality.json")))

    # Basic sanity before touching the database
    assert cells["cell_id"].is_unique, "duplicate cell_id in cells.csv"
    assert set(shap_df["cell_id"]) <= set(cells["cell_id"]), "SHAP rows for unknown cells"
    assert set(scen["cell_id"]) <= set(cells["cell_id"]), "scenario rows for unknown cells"
    assert cells["confidence"].isin(["High", "Medium", "Low"]).all(), "unexpected confidence label"
    em_not_low = cells[(cells["emerging_risk"] == 1) & (cells["confidence"] != "Low")]
    if len(em_not_low):
        print(f"WARNING: {len(em_not_low)} emerging-risk cells are not Low confidence "
              f"(the brief says they are Low by design).")

    yearly = pd.DataFrame(dq.get("yearly_counts", []), columns=["year", "month", "crashes"])
    checks = pd.DataFrame([{"check_name": c["check_name"], "status": c["status"], "detail": c["detail"]}
                           for c in dq["checks"]])

    if a.db.exists():
        a.db.unlink()                      # start clean; the file is rebuilt from the exports
    eng = create_engine(f"sqlite:///{a.db}")
    with eng.begin() as con:
        for t in DROP_ORDER:
            con.execute(text(f"DROP TABLE IF EXISTS {t}"))
        for stmt in SCHEMA:
            con.execute(text(stmt))
        cells.to_sql("cells", con, if_exists="append", index=False)
        shap_df.to_sql("cell_shap", con, if_exists="append", index=False)
        scen.to_sql("cell_scenarios", con, if_exists="append", index=False, chunksize=20000)
        yearly.to_sql("yearly_counts", con, if_exists="append", index=False)
        checks.to_sql("data_quality", con, if_exists="append", index=False)
        metrics[["group_name", "metric_name", "model_value", "history_value", "extra_json"]] \
            .to_sql("metrics", con, if_exists="append", index=False)

    with eng.connect() as con:
        print(f"Built {a.db} ({a.db.stat().st_size / 1e6:.1f} MB)")
        for t in ["cells", "cell_shap", "cell_scenarios", "yearly_counts", "data_quality", "metrics"]:
            n = con.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            print(f"  {t:<15} {n:>8,} rows")
        em = con.execute(text("SELECT COUNT(*) FROM cells WHERE emerging_risk = 1")).scalar()
        w = con.execute(text("SELECT COUNT(*) FROM data_quality WHERE status = 'WARN'")).scalar()
        f = con.execute(text("SELECT COUNT(*) FROM data_quality WHERE status = 'FAIL'")).scalar()
        print(f"Emerging-risk cells: {em}.  Data-quality WARN: {w}, FAIL: {f}.")


if __name__ == "__main__":
    main()
