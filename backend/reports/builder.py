"""Region Report builder: JSON payload, matplotlib charts (Agg) and a reportlab PDF.

Every number and sentence in the PDF comes from the payload. The full payload is attached to the PDF as
`waymark_report.json`, byte for byte equal to what is stored, so the assistant can read a report back from the PDF.
"""
from __future__ import annotations

import io
import secrets
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from pypdf import PdfReader, PdfWriter  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle  # noqa: E402

from ..schemas_ops import ESTIMATE_NOTE, SCHEMA_VERSION, RegionAnalysis, RegionReport  # noqa: E402

ATTACHMENT_NAME = "waymark_report.json"
NAVY, BRASS, BRICK = "#12203b", "#b8893b", "#b3412f"
PLACEHOLDER_NOTE = ("Placeholder weights: the effect weights used for the adjusted risk estimate are placeholders "
                    "until a domain owner replaces them in backend/config/effects.json.")


def utc_iso(dt: datetime | None = None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).replace(tzinfo=None, microsecond=0).isoformat() + "Z"


def new_report_id(now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"WMK-{now:%Y%m%d}-{secrets.token_hex(3).upper()}"


def build_report(report_id: str, analysis: RegionAnalysis, data_version: str, placeholder_weights: bool,
                 generated_at: str | None = None) -> RegionReport:
    return RegionReport(report_id=report_id, schema_version=SCHEMA_VERSION, generated_at=generated_at or utc_iso(),
                        data_version=data_version, analysis=analysis, placeholder_weights=placeholder_weights)


def payload_text(report: RegionReport) -> str:
    """The canonical stored form. The PDF attachment and reports.payload_json both use exactly this string."""
    return report.model_dump_json()


# ------------------------------------------------------------------ charts
def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def year_chart(analysis: RegionAnalysis) -> bytes | None:
    if not analysis.year_trend:
        return None
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    ax.bar([str(y.year) for y in analysis.year_trend], [y.crashes for y in analysis.year_trend], color=NAVY)
    ax.set_title("Recorded crashes per year", loc="left", fontsize=10, color=NAVY)
    ax.set_ylabel("Crashes", fontsize=8)
    ax.tick_params(labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    return _png(fig)


def hour_chart(analysis: RegionAnalysis) -> bytes | None:
    if not analysis.hour_of_day or sum(h.crashes for h in analysis.hour_of_day) == 0:
        return None
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    ax.bar([h.hour for h in analysis.hour_of_day], [h.crashes for h in analysis.hour_of_day], color=BRASS)
    ax.set_title("Recorded crashes by hour of day", loc="left", fontsize=10, color=NAVY)
    ax.set_xlabel("Hour of day (0 to 23)", fontsize=8)
    ax.set_ylabel("Crashes", fontsize=8)
    ax.set_xticks(range(0, 24, 3))
    ax.tick_params(labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    return _png(fig)


# ------------------------------------------------------------------ PDF
def _fmt(v, nd: int = 1, dash: str = "n/a") -> str:
    return dash if v is None else f"{v:,.{nd}f}"


def _p(text: str, style) -> Paragraph:
    return Paragraph(escape(text), style)


def render_pdf(report: RegionReport, path: Path) -> None:
    a = report.analysis
    path.parent.mkdir(parents=True, exist_ok=True)
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=9.5, leading=13)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=10.5, textColor=colors.HexColor("#444444"))
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, leading=24, alignment=0, textColor=colors.HexColor(NAVY))
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12.5, textColor=colors.HexColor(NAVY), spaceBefore=10)
    cell = ParagraphStyle("cell", parent=body, fontSize=8.5, leading=10.5)

    story: list = [
        _p("WAYMARK Region Report", h1),
        _p(a.region.name, ParagraphStyle("sub", parent=body, fontSize=12)),
        _p(f"Generated {report.generated_at.replace('T', ' ').replace('Z', ' UTC')} · Region {a.region.kind}: "
           f"{a.region.key} · {a.region.cell_count:,} cells", small),
        Spacer(1, 6),
    ]

    stats = [
        ("Region risk index", _fmt(a.risk_index, 1) + " / 100"),
        ("Scored cells", f"{a.region.cell_count:,}"),
        ("Past crashes", "n/a" if a.total_crashes is None else f"{a.total_crashes:,}"),
        ("Emerging-risk cells", f"{a.emerging_cells:,}"),
    ]
    stat_tbl = Table([[Paragraph(f"<font size=8 color='#666666'>{escape(k)}</font><br/><font size=15><b>{escape(v)}</b></font>", body)
                       for k, v in stats]], colWidths=[43 * mm] * 4)
    stat_tbl.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#cccccc")),
                                  ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#cccccc")),
                                  ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#faf7f2")),
                                  ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                  ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story += [stat_tbl, Spacer(1, 3), _p(a.risk_index_method, small)]
    if a.night_share is not None or a.severe_share is not None:
        bits = []
        if a.night_share is not None:
            bits.append(f"Night-time crashes: {a.night_share * 100:.0f}%")
        if a.severe_share is not None:
            bits.append(f"Severity 3 or higher: {a.severe_share * 100:.0f}%")
        story.append(_p(" · ".join(bits), small))

    story.append(_p("Top hotspot cells", h2))
    rows = [[Paragraph(f"<b>{h}</b>", cell) for h in ("#", "Cell", "Score", "Past crashes", "Confidence", "Locality")]]
    for h in a.hotspots:
        rows.append([_p(str(h.rank), cell), _p(h.cell_id, cell), _p(_fmt(h.base_score, 1), cell),
                     _p(f"{h.n_past_crashes:,}", cell),
                     _p((h.confidence or "n/a") + (" · emerging" if h.emerging_risk else ""), cell),
                     _p(h.locality or "n/a", cell)])
    tbl = Table(rows, colWidths=[8 * mm, 36 * mm, 15 * mm, 22 * mm, 34 * mm, 57 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1ece2")),
                             ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(tbl if a.hotspots else _p("No scored cells.", body))

    charts = [(year_chart(a), "Year trend"), (hour_chart(a), "Hour of day")]
    if all(c is None for c, _ in charts):
        story += [_p("Trend charts", h2), _p("Crash records are not available for this region, so no trend charts "
                                             "are shown.", body)]
    for png, label in charts:
        if png:
            story.append(KeepTogether([_p(label, h2), Image(io.BytesIO(png), width=150 * mm, height=61 * mm)]))

    story.append(_p("Priority issues", h2))
    if a.priority_issues:
        for issue in a.priority_issues:
            ev = " ".join(issue.evidence)
            ids = ", ".join(issue.cell_ids[:5]) + (f" and {len(issue.cell_ids) - 5} more" if len(issue.cell_ids) > 5 else "")
            story.append(KeepTogether([_p(issue.title, ParagraphStyle("it", parent=body, fontName="Helvetica-Bold")),
                                       _p(ev, body), _p(f"Cells: {ids}", small), Spacer(1, 4)]))
    else:
        story.append(_p("No priority issue met the thresholds for this region.", body))

    story.append(_p("Caveats", h2))
    for c in a.caveats:
        story.append(_p("• " + c, body))
    story += [Spacer(1, 8), _p(report.disclaimer or ESTIMATE_NOTE, small)]
    if report.placeholder_weights:
        story.append(_p(PLACEHOLDER_NOTE, small))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(18 * mm, 10 * mm, f"Report ID {report.report_id}")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"WAYMARK · decision support only · page {doc.page}")
        canvas.restoreState()

    raw = io.BytesIO()
    SimpleDocTemplate(raw, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                      title=f"WAYMARK Region Report {report.report_id}", author="WAYMARK",
                      ).build(story, onFirstPage=footer, onLaterPages=footer)

    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(raw.getvalue())))
    writer.add_attachment(ATTACHMENT_NAME, payload_text(report).encode("utf-8"))
    with open(path, "wb") as fh:
        writer.write(fh)
