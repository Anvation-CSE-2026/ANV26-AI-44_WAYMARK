"""Tests run against a tiny temporary database, never your real waymark.db."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.db import get_db
from backend.main import app
from backend.models import Base, Cell, CellScenario, CellShap, Crash, DataQuality, Metric, YearlyCount


def _cell(cid, lat, lng, n, score, sim, conf, em, p, factors="n_acc", recs="Prioritise for a detailed site safety audit"):
    return Cell(cell_id=cid, lat=lat, lng=lng, n_past_crashes=n, risk_score=score, risk_vs_similar_history=sim,
                history_percentile=50.0, confidence=conf, top_factors=factors, recommendations=recs,
                emerging_risk=em, baseline_prob=p)


@pytest.fixture()
def client(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'t.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    S = sessionmaker(bind=engine, expire_on_commit=False)
    with S() as db:
        db.add_all([
            _cell("EM1", 29.70, -95.40, 1, 55.0, 99.0, "Low", 1, 0.20, "nb_acc, mean_vis", "Add fog warnings | Audit the corridor"),
            _cell("EM2", 29.80, -95.30, 2, 50.0, 95.0, "Low", 1, 0.10),
            _cell("BIG", 29.75, -95.35, 40, 100.0, 99.9, "High", 0, 0.90),
            _cell("MID", 29.60, -95.50, 4, 20.0, 40.0, "Medium", 0, 0.05),
        ])
        # scenarios: EM1 goes UP at night, EM2 goes DOWN at night, others unchanged
        base = {"EM1": 0.20, "EM2": 0.10, "BIG": 0.90, "MID": 0.05}
        night = {"EM1": 0.30, "EM2": 0.06, "BIG": 0.90, "MID": 0.05}
        for cid, b in base.items():
            for ni in (0, 1):
                for ra in (0, 1):
                    for lv in (0, 1):
                        p = night[cid] if (ni and not ra and not lv) else b
                        db.add(CellScenario(cell_id=cid, night=ni, rain=ra, low_vis=lv, probability=p))
        db.add_all([
            Crash(crash_id="C1", cell_id="EM1", lat=29.701, lng=-95.401, start_time="2021-05-01 08:30", year=2021,
                  severity=2, weather="Rain", night=0),
            Crash(crash_id="C2", cell_id="BIG", lat=29.751, lng=-95.351, start_time="2022-01-02 22:10", year=2022,
                  severity=3, weather="", night=1),
        ])
        db.add_all([CellShap(cell_id="EM1", rank=1, feature="nb_acc", feature_value=50, shap_value=0.4),
                    CellShap(cell_id="EM1", rank=2, feature="n_acc", feature_value=1, shap_value=-0.3)])
        db.add_all([DataQuality(check_name="Row count", status="PASS", detail="ok"),
                    DataQuality(check_name="2017 jump", status="WARN", detail="jump")])
        for y, c in ((2016, 100), (2017, 200), (2018, 210)):
            for m in range(1, 13):
                db.add(YearlyCount(year=y, month=m, crashes=c))
        db.add(YearlyCount(year=2019, month=1, crashes=50))
        db.add_all([
            Metric(group_name="overall", metric_name="auc", model_value=0.88, history_value=0.87,
                   extra_json='{"split": "features<=2021, label 2022", "cells": 4}'),
            Metric(group_name="low_history", metric_name="capture_top10", model_value=0.24, history_value=0.11,
                   extra_json='{"blackspots": 9, "history_capture_top10_tie_avg": 0.15}'),
            Metric(group_name="robustness_N2", metric_name="capture_top10", model_value=0.3, history_value=0.2,
                   extra_json='{"min_crashes": 2}'),
            Metric(group_name="bootstrap_low_history", metric_name="capture_top10", model_value=0.24, history_value=0.15,
                   extra_json='{"model": {"point": 0.24, "ci95": [0.1, 0.3]}, "history": {"point": 0.15, "ci95": [0.1, 0.2]}}'),
        ])
        db.commit()

    def override():
        with S() as db:
            yield db

    app.dependency_overrides[get_db] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------------------------------------------
# Operations build fixtures: a small database with REAL H3 cells so region resolution can be tested exactly.
# ---------------------------------------------------------------------------------------------------------------
import h3  # noqa: E402

from backend import evidence_service  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.models_ops import create_ops_tables  # noqa: E402

OPS_PARENT = h3.latlng_to_cell(29.76, -95.37, 7)
OPS_CELLS = sorted(h3.cell_to_children(OPS_PARENT, 9))          # 49 cells; risk_score = 1..49 so the mean is exactly 25.0
OTHER_PARENT = h3.latlng_to_cell(29.95, -95.20, 7)
OTHER_CELLS = sorted(h3.cell_to_children(OTHER_PARENT, 9))[:2]


@pytest.fixture(autouse=True)
def _ops_env(tmp_path, monkeypatch):
    """Isolated data dir, a long JWT secret, demo mode on, and a clean upload rate limiter for every test."""
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    monkeypatch.setattr(settings, "jwt_secret", "test-secret-test-secret-test-secret-0123456789")
    monkeypatch.setattr(settings, "demo_mode", True)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    monkeypatch.setattr(settings, "upload_rate_per_min", 10)
    monkeypatch.setattr(settings, "max_upload_mb", 10)
    evidence_service.reset_rate_limits()
    yield


@pytest.fixture()
def ops(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'ops.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    create_ops_tables(engine)
    S = sessionmaker(bind=engine, expire_on_commit=False)
    with S() as db:
        for i, cid in enumerate(OPS_CELLS):
            lat, lng = h3.cell_to_latlng(cid)
            db.add(_cell(cid, lat, lng, i % 5 + 1, float(i + 1), 50.0 + i, ("High", "Medium", "Low")[i % 3],
                         1 if i in (3, 4) else 0, 0.01 * (i + 1)))
        for cid in OTHER_CELLS:
            lat, lng = h3.cell_to_latlng(cid)
            db.add(_cell(cid, lat, lng, 2, 40.0, 60.0, "Low", 0, 0.1))
        # crashes: 10 in the first cell, 6 in the second, 2 elsewhere; mixed years, hours, night, severity
        specs = [(OPS_CELLS[0], 10, "Main St"), (OPS_CELLS[1], 6, "I-610 E"), (OPS_CELLS[2], 2, "Elm St")]
        n = 0
        for cid, count, street in specs:
            lat, lng = h3.cell_to_latlng(cid)
            for k in range(count):
                n += 1
                year = (2020, 2021, 2022)[k % 3]
                hour = 22 if k % 2 == 0 else 8
                db.add(Crash(crash_id=f"X{n}", cell_id=cid, lat=lat, lng=lng, start_time=f"{year}-05-01 {hour:02d}:10",
                             year=year, severity=3 if k % 4 == 0 else 2, weather="Clear", night=1 if hour == 22 else 0,
                             city="Houston", county="Harris", zipcode="77002", street=street))
        db.add(DataQuality(check_name="2017 jump", status="WARN", detail="jump"))
        db.commit()

    def override():
        with S() as db:
            yield db

    app.dependency_overrides[get_db] = override
    c = TestClient(app)
    c.S, c.engine = S, engine
    yield c
    app.dependency_overrides.clear()


def auth(client: TestClient, role: str = "planner", demo: bool = True, **creds) -> dict:
    """Authorization header for a demo role token (or a real login when demo=False)."""
    if demo:
        tok = client.post("/api/auth/demo", json={"role": role}).json()["access_token"]
    else:
        tok = client.post("/api/auth/login", json=creds).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def make_measure(client: TestClient, headers: dict, category: str = "street_lighting", cells=None, **extra) -> dict:
    body = {"region_kind": "h3_parent", "region_key": OPS_PARENT, "title": "Improve lighting on Main St",
            "category": category, "cell_ids": cells or OPS_CELLS[:2]} | extra
    r = client.post("/api/measures", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def jpeg_bytes(size=(64, 48), color=(200, 30, 30), exif=None) -> bytes:
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="JPEG", **({"exif": exif} if exif else {}))
    return buf.getvalue()
