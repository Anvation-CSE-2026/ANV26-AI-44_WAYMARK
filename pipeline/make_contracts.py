#!/usr/bin/env python3
"""
WAYMARK | pipeline/make_contracts.py

Regenerates the frozen contract files from the REAL database and the real API:
  contracts/sample_report.json   a RegionReport for one real Harris County H3 region (res 7, around the top cell)
  contracts/openapi_stub.json    the OpenAPI document of the running app (every endpoint, schemas included)

The frontend mocks (frontend/src/lib/mocks/report.json) are copied from the sample report.
Read-only on the database. Usage (from the project root):   python pipeline/make_contracts.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import h3  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend.config_loader import placeholder_weights  # noqa: E402
from backend.db import DB_PATH, engine  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models import Cell  # noqa: E402
from backend.regions import _cells_by_ids, analyse_region, data_version, resolve_region  # noqa: E402
from backend.reports.builder import build_report, payload_text  # noqa: E402

SAMPLE_ID = "WMK-20261008-5A3B1E"


def main() -> None:
    if not DB_PATH.exists():
        sys.exit(f"Database not found at {DB_PATH}. Run: python pipeline/load_db.py")
    out = ROOT / "contracts"
    out.mkdir(exist_ok=True)
    with Session(engine) as db:
        top = db.scalar(select(Cell.cell_id).order_by(Cell.risk_score.desc(), Cell.cell_id).limit(1))
        parent = h3.cell_to_parent(top, 7)
        resolved = resolve_region(db, "h3_parent", parent)
        analysis = analyse_region(db, resolved)
        version = data_version(_cells_by_ids(db, resolved.cell_ids))
    report = build_report(SAMPLE_ID, analysis, version, placeholder_weights(), generated_at="2026-10-08T12:00:00Z")
    (out / "sample_report.json").write_text(json.dumps(json.loads(payload_text(report)), indent=2) + "\n", encoding="utf-8")
    (out / "openapi_stub.json").write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    mocks = ROOT / "frontend" / "src" / "lib" / "mocks"
    if mocks.exists():
        shutil.copyfile(out / "sample_report.json", mocks / "report.json")
    print(f"Wrote {out / 'sample_report.json'} (region {parent}, {analysis.region.cell_count} cells, "
          f"index {analysis.risk_index}) and {out / 'openapi_stub.json'}")


if __name__ == "__main__":
    main()
