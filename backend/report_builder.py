"""Region analysis and PDF report generation."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import DATA_DIR
from .models import Cell, Crash, Report
from .region import bbox_for_cells, cells_for_region, region_label
from .schemas_ops import Hotspot, RegionAnalysis


def analyse_region(db: Session, region_id: str, report_id: str | None = None, version: int = 1) -> RegionAnalysis:
    cells = cells_for_region(db, region_id)
    if not cells:
        raise ValueError("No scored cells were found for this region")
    name_id, name = region_label(db, region_id)
    cell_ids = [c.cell_id for c in cells]
    crash_count = db.scalar(select(Crash.crash_id).where(Crash.cell_id.in_(cell_ids)).count()) if False else None
    crash_count = len(db.scalars(select(Crash.crash_id).where(Crash.cell_id.in_(cell_ids))).all())
    scores = [float(c.risk_score or 0) for c in cells]
    base_index = sum(scores) / len(scores)
    hotspots = [Hotspot(cell_id=c.cell_id, lat=c.lat, lng=c.lng, risk_score=c.risk_score,
                        n_past_crashes=c.n_past_crashes,
                        top_factors=[x.strip() for x in (c.top_factors or '').split(',') if x.strip()])
                for c in cells[:10]]
    south, west, north, east = bbox_for_cells(cells)
    return RegionAnalysis(
        report_id=report_id, report_version=version, region_id=name_id, region_name=name,
        region_kind="h3" if name.startswith("H3 region") else "locality",
        generated_at=datetime.now(timezone.utc), base_index=round(base_index, 3), adjusted_index=round(base_index, 3),
        cells_scored=len(cells), crash_count=crash_count, hotspots=hotspots,
        priority_issues=["Review the highest-scoring cells with a qualified road-safety team."],
        caveats=["One-city historical backtest; this report is decision support, not proof of causation."],
        charts={"bbox": {"south": south, "west": west, "north": north, "east": east}},
    )


def write_pdf(report: RegionAnalysis, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".base.pdf")
    pdf = canvas.Canvas(str(temp), pagesize=letter)
    pdf.setTitle(f"WAYMARK report {report.report_id}")
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(54, 738, f"WAYMARK Region Analysis: {report.region_name}")
    pdf.setFont("Helvetica", 11)
    lines = [
        f"Report ID: {report.report_id}", f"Cells scored: {report.cells_scored}",
        f"Crash records: {report.crash_count}", f"Base risk index: {report.base_index:.3f}",
        "", "Priority issues:", *[f"- {item}" for item in report.priority_issues],
        "", "Caveats:", *[f"- {item}" for item in report.caveats],
    ]
    y = 708
    for line in lines:
        pdf.drawString(54, y, line[:110])
        y -= 17
    pdf.setFont("Helvetica-Oblique", 9)
    pdf.drawString(54, 48, f"Report ID: {report.report_id} | WAYMARK decision support")
    pdf.save()

    writer = PdfWriter(clone_from=str(temp))
    writer.add_attachment("waymark-report.json", report.model_dump_json(indent=2).encode())
    with path.open("wb") as handle:
        writer.write(handle)
    temp.unlink(missing_ok=True)
