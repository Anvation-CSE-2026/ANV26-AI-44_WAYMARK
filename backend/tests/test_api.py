import pytest


# ---------- cell detail ----------
def test_cell_detail_full(client):
    r = client.get("/api/cells/EM1")
    assert r.status_code == 200
    d = r.json()
    assert d["headline"] == "Riskier than 99% of cells with similar history"
    assert d["confidence"] == "Low" and "Low confidence" in d["confidence_explanation"]
    assert d["audit_banner"] == "Elevated risk, recommend a site audit" and d["recommend_audit"] is True
    assert d["suggested_actions"] == ["Add fog warnings", "Audit the corridor"]
    assert d["top_factors"] == ["nb_acc", "mean_vis"]
    assert [s["direction"] for s in d["shap"]] == ["raises", "lowers"]
    assert d["shap"][0]["label"] == "Crashes in neighbouring cells"
    assert len(d["scenarios"]) == 8
    assert d["google_maps_url"].startswith("https://www.google.com/maps/search/?api=1&query=29.7")


def test_cell_detail_without_shap_and_banner(client):
    d = client.get("/api/cells/MID").json()
    assert d["shap"] == [] and d["shap_available"] is False


def test_cell_detail_not_found(client):
    r = client.get("/api/cells/NOPE")
    assert r.status_code == 404 and "not found" in r.json()["detail"]


def test_wording_never_says_will(client):
    text = client.get("/api/cells/EM1").text.lower()
    assert " will " not in text


# ---------- what-if ----------
def test_whatif_night(client):
    d = client.get("/api/whatif?night=true").json()
    by = {i["cell_id"]: i for i in d["items"]}
    assert d["label"] == "Scenario simulation, not a live forecast"
    assert by["EM1"]["change"] == pytest.approx(0.10)       # goes up
    assert by["EM2"]["change"] == pytest.approx(-0.04)      # goes down, reported as a plain negative number
    assert d["n_cells"] == 4 and d["n_emerging"] == 2
    assert d["mean_change_all"] == pytest.approx((0.10 - 0.04) / 4)
    assert d["mean_change_emerging"] == pytest.approx(0.03)
    assert d["share_cells_higher"] == pytest.approx(0.25)


def test_whatif_no_flags_means_no_change(client):
    d = client.get("/api/whatif").json()
    assert d["mean_change_all"] == pytest.approx(0.0)
    assert all(i["change"] == pytest.approx(0.0) for i in d["items"])


def test_whatif_rejects_bad_flag(client):
    assert client.get("/api/whatif?night=maybe").status_code == 422


# ---------- cells list, validation, metrics, audit ----------
def test_cells_filters(client):
    assert client.get("/api/cells").json()["total"] == 4
    assert client.get("/api/cells?emerging_only=true").json()["total"] == 2
    assert client.get("/api/cells?max_past_crashes=2").json()["total"] == 2
    assert client.get("/api/cells?confidence=low,medium").json()["total"] == 3
    assert client.get("/api/cells?min_score=60").json()["total"] == 1
    assert client.get("/api/cells?bbox=29.65,-95.45,29.85,-95.25").json()["total"] == 3
    assert client.get("/api/cells?limit=1").json()["count"] == 1


def test_cells_empty_and_bad_input(client):
    assert client.get("/api/cells?min_score=100&emerging_only=true").json() == \
        {"total": 0, "count": 0, "limit": 10000, "offset": 0, "items": []}
    assert client.get("/api/cells?bbox=1,2,3").status_code == 422
    assert client.get("/api/cells?confidence=extreme").status_code == 422


def test_validation_flags_jump_and_partial(client):
    d = client.get("/api/validation").json()
    assert d["counts"] == {"PASS": 1, "WARN": 1, "FAIL": 0}
    yt = {y["year"]: y for y in d["yearly_totals"]}
    assert yt[2017]["jump"] is True and yt[2018]["jump"] is False
    assert yt[2019]["partial"] is True and yt[2019]["months_covered"] == 1


def test_metrics_use_fair_baseline(client):
    d = client.get("/api/metrics").json()
    cap = d["low_history"]["metrics"]["capture_top10"]
    assert cap["history"] == 0.11 and cap["history_fair"] == 0.15
    assert [g["group_name"] for g in d["robustness"]] == ["robustness_N2"]
    assert d["bootstrap"]["model"]["ci95"] == [0.1, 0.3]
    assert "not proof" in d["caveat"]


def test_summary(client):
    d = client.get("/api/summary").json()
    assert (d["cells_scored"], d["low_history_cells"], d["emerging_risk_cells"]) == (4, 2, 2)
    assert d["headline"]["low_history_capture_top10_history"] == 0.15
    assert d["headline"]["scoring_basis"] == "features<=2021, label 2022"


def test_audit_list_and_csv(client):
    d = client.get("/api/audit-list").json()
    assert d["total"] == 2 and d["items"][0]["cell_id"] == "EM1"
    assert client.get("/api/audit-list?q=fog").json()["total"] == 1
    assert client.get("/api/audit-list?q=zzz").json()["items"] == []
    r = client.get("/api/audit-list?format=csv")
    assert r.headers["content-type"].startswith("text/csv") and "attachment" in r.headers["content-disposition"]
    assert r.text.splitlines()[0].startswith("cell_id,region,lat,lng") and "EM1" in r.text
    assert client.get("/api/audit-list?sort=bogus").status_code == 422


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "database": True, "cells": 4}
