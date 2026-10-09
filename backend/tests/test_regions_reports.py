"""S1: region resolution, exact index numbers, report payload, PDF with Report ID and embedded JSON."""
import io
import json
import re
from pathlib import Path

import pytest
from pypdf import PdfReader

from backend import regions
from backend.config import settings
from backend.models import Cell
from backend.regions import analyse_region, region_risk_index, resolve_region
from backend.schemas_ops import RegionReport
from backend.tests.conftest import OPS_CELLS, OPS_PARENT, OTHER_CELLS, auth


# ---------------------------------------------------------------- resolve
def test_resolve_h3_parent_exact(ops):
    r = ops.get("/api/regions/resolve", params={"kind": "h3_parent", "key": OPS_PARENT})
    assert r.status_code == 200
    d = r.json()
    assert d["cell_count"] == 49 and d["kind"] == "h3_parent" and "resolution 7" in d["name"]
    assert d["bounds"]["south"] < d["bounds"]["north"] and d["bounds"]["west"] < d["bounds"]["east"]


def test_resolve_is_public_and_other_kinds(ops):
    assert "Authorization" not in ops.headers
    s, w, n, e = 29.0, -96.0, 31.0, -95.0
    r = ops.get("/api/regions/resolve", params={"kind": "bbox", "key": f"{s},{w},{n},{e}"})
    assert r.status_code == 200 and r.json()["cell_count"] == 51
    r = ops.get("/api/regions/resolve", params={"kind": "locality", "key": "Street:Main St"})
    assert r.status_code == 200 and r.json()["cell_count"] == 1 and r.json()["name"] == "Street: Main St"
    r = ops.get("/api/regions/resolve", params={"kind": "locality", "key": "ZIP code:77002"})
    assert r.json()["cell_count"] == 3                      # the three cells that hold crashes


@pytest.mark.parametrize("kind,key,status", [
    ("h3_parent", "not-a-cell", 404),
    ("h3_parent", "87446ca85ffffff" if False else "8001fffffffffff", 422),   # valid H3, but contains no scored cells
    ("bbox", "1,2,3", 422),
    ("bbox", "40,-96,41,-95", 422),                         # valid box, no scored cells
    ("bbox", "31,-95,29,-96", 422),                         # wrong order
    ("locality", "Nowhereville", 404),
    ("planet", "x", 422),
])
def test_resolve_errors(ops, kind, key, status):
    r = ops.get("/api/regions/resolve", params={"kind": kind, "key": key})
    assert r.status_code == status, r.text
    assert isinstance(r.json()["detail"], str) and len(r.json()["detail"]) > 10


def test_oversized_region_is_422(ops, monkeypatch):
    monkeypatch.setattr(settings, "max_report_cells", 10)
    r = ops.get("/api/regions/resolve", params={"kind": "h3_parent", "key": OPS_PARENT})
    assert r.status_code == 422 and "limit" in r.json()["detail"]
    assert ops.post("/api/reports", json={"region_kind": "h3_parent", "region_key": OPS_PARENT},
                    headers=auth(ops)).status_code == 422


# ---------------------------------------------------------------- index numbers
def test_region_risk_index_exact_numbers():
    assert region_risk_index([10.0, 20.0, 60.0]) == pytest.approx(30.0)
    assert region_risk_index([10.0, None, 30.0]) == pytest.approx(20.0)      # unscored cells are skipped
    assert region_risk_index([]) is None and region_risk_index([None]) is None
    assert region_risk_index([Cell(cell_id="a", lat=0, lng=0, n_past_crashes=0, risk_score=50.0, emerging_risk=0)]) == 50.0


def test_index_on_fixture_db_is_25(ops):
    with ops.S() as db:
        a = analyse_region(db, resolve_region(db, "h3_parent", OPS_PARENT))
    assert a.risk_index == 25.0                              # mean of 1..49
    assert a.region.cell_count == 49 and a.emerging_cells == 2 and a.total_crashes == 18
    assert [h.cell_id for h in a.hotspots[:3]] == OPS_CELLS[::-1][:3]        # highest score first
    assert [h.base_score for h in a.hotspots[:3]] == [49.0, 48.0, 47.0] and a.hotspots[0].rank == 1
    assert len(a.hotspots) == 10


def test_analysis_trend_hours_and_issues(ops, monkeypatch):
    monkeypatch.setattr(regions, "TOP_HOTSPOTS", 49)         # list every cell so the low-scoring cells with crashes appear
    with ops.S() as db:
        a = analyse_region(db, resolve_region(db, "h3_parent", OPS_PARENT))
    assert {y.year: y.crashes for y in a.year_trend} == {2020: 7, 2021: 6, 2022: 5}
    hours = {h.hour: h.crashes for h in a.hour_of_day}
    assert len(hours) == 24 and hours[22] == 9 and hours[8] == 9 and sum(hours.values()) == 18
    assert a.night_share == 0.5 and a.severe_share == pytest.approx(0.3333, abs=1e-4)
    ids = {i.id for i in a.priority_issues}
    assert "emerging_risk" in ids and "night_crashes" not in ids          # 50% night vs 50% dataset-wide: not above 1.25x
    em = next(i for i in a.priority_issues if i.id == "emerging_risk")
    assert "2 of 49 cells" in em.evidence[0]
    assert any("Data-quality WARN" in c for c in a.caveats) and any("not predictions" in c for c in a.caveats)
    top = next(h for h in a.hotspots if h.cell_id == OPS_CELLS[0])
    assert top.locality == "Main St"


def test_analysis_without_crash_table(ops):
    from sqlalchemy import text
    with ops.engine.begin() as con:
        con.execute(text("DROP TABLE crashes"))
    with ops.S() as db:
        a = analyse_region(db, resolve_region(db, "h3_parent", OPS_PARENT))
    assert a.total_crashes is None and a.year_trend == [] and a.hour_of_day == []
    assert any("Crash records are not loaded" in c for c in a.caveats) and a.risk_index == 25.0


# ---------------------------------------------------------------- report endpoints
def _create(ops, headers, kind="h3_parent", key=OPS_PARENT):
    r = ops.post("/api/reports", json={"region_kind": kind, "region_key": key}, headers=headers)
    assert r.status_code == 202, r.text
    return r.json()


def test_report_lifecycle_payload_matches_schema(ops):
    h = auth(ops)
    created = _create(ops, h)
    assert re.fullmatch(r"WMK-\d{8}-[0-9A-F]{6}", created["report_id"]) and created["status"] == "pending"
    got = ops.get(f"/api/reports/{created['report_id']}", headers=h).json()     # background task already ran
    assert got["status"] == "ready" and got["error_safe"] is None
    report = RegionReport.model_validate(got["payload"])
    assert report.analysis.risk_index == 25.0 and report.placeholder_weights is True
    assert report.report_id == created["report_id"] and report.generated_at.endswith("Z") and len(report.data_version) == 16
    listing = ops.get("/api/reports", params={"region_kind": "h3_parent", "region_key": OPS_PARENT}, headers=h).json()
    assert [x["report_id"] for x in listing] == [created["report_id"]]
    assert ops.get("/api/reports", params={"region_kind": "h3_parent", "region_key": "x"}, headers=h).json() == []


def test_report_requires_auth_and_valid_id(ops):
    assert ops.post("/api/reports", json={"region_kind": "h3_parent", "region_key": OPS_PARENT}).status_code == 401
    h = auth(ops)
    assert ops.get("/api/reports/WMK-20200101-ABCDEF", headers=h).status_code == 404
    assert ops.get("/api/reports/WMK-1", headers=h).status_code == 404
    assert ops.get("/api/reports/anything", headers=h).status_code == 404
    assert ops.get("/api/reports/WMK-20200101-ABCDEF/pdf", headers=h).status_code == 404


def test_pdf_has_report_id_footer_on_every_page_and_embedded_json(ops):
    h = auth(ops)
    rid = _create(ops, h)["report_id"]
    pdf = ops.get(f"/api/reports/{rid}/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in pdf.headers["content-disposition"] and rid in pdf.headers["content-disposition"]
    reader = PdfReader(io.BytesIO(pdf.content))
    assert len(reader.pages) >= 1
    for page in reader.pages:
        assert f"Report ID {rid}" in page.extract_text()
    stored = ops.get(f"/api/reports/{rid}/json", headers=h)
    assert stored.status_code == 200 and "attachment" in stored.headers["content-disposition"]
    embedded = reader.attachments["waymark_report.json"][0]
    assert embedded == stored.content                       # byte for byte
    assert json.loads(embedded)["report_id"] == rid
    text = " ".join(p.extract_text() for p in reader.pages)
    assert "25.0 / 100" in text and "Placeholder weights" in text and "not predictions" in text.replace("\n", " ")


def test_pdf_text_only_uses_payload_numbers(ops):
    h = auth(ops)
    rid = _create(ops, h)["report_id"]
    payload = ops.get(f"/api/reports/{rid}", headers=h).json()["payload"]
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(ops.get(f"/api/reports/{rid}/pdf", headers=h).content)).pages)
    for hs in payload["analysis"]["hotspots"][:3]:
        assert hs["cell_id"] in text and f"{hs['base_score']:.1f}" in text


def test_failed_generation_is_safe(ops, monkeypatch):
    def boom(db, resolved):
        raise RuntimeError("secret path C:\\private\\db.sqlite and SELECT * FROM cells")
    monkeypatch.setattr("backend.routes.reports.analyse_region", boom)
    h = auth(ops)
    rid = _create(ops, h)["report_id"]
    got = ops.get(f"/api/reports/{rid}", headers=h).json()
    assert got["status"] == "failed" and got["payload"] is None
    for leak in ("secret", "SELECT", "private", "Traceback", "RuntimeError"):
        assert leak not in got["error_safe"]
    assert ops.get(f"/api/reports/{rid}/pdf", headers=h).status_code == 404
    assert ops.get(f"/api/reports/{rid}/json", headers=h).status_code == 404


def test_unknown_region_fails_fast(ops):
    r = ops.post("/api/reports", json={"region_kind": "locality", "region_key": "Nowhereville"}, headers=auth(ops))
    assert r.status_code == 404


def test_two_reports_are_listed_newest_first(ops):
    h = auth(ops)
    a, b = _create(ops, h)["report_id"], _create(ops, h)["report_id"]
    listing = ops.get("/api/reports", params={"region_kind": "h3_parent", "region_key": OPS_PARENT}, headers=h).json()
    assert [x["report_id"] for x in listing] == [b, a]


# ---------------------------------------------------------------- places refactor keeps its behaviour
def test_places_search_unchanged(ops):
    d = ops.get("/api/places", params={"q": "Main"}).json()
    assert d["items"][0]["name"] == "Main St" and d["items"][0]["kind"] == "Street" and d["items"][0]["crash_count"] == 10
    assert ops.get("/api/places", params={"q": "houston"}).json()["items"][0]["kind"] in ("City", "County")


# ---------------------------------------------------------------- contracts
def test_sample_report_contract_validates():
    p = Path(__file__).resolve().parents[2] / "contracts" / "sample_report.json"
    if not p.exists():
        pytest.skip("contracts/sample_report.json not generated yet (python pipeline/make_contracts.py)")
    RegionReport.model_validate_json(p.read_text(encoding="utf-8"))
