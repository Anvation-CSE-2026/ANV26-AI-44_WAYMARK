"""S2: measures API, state machine, permissions, progress numbers, risk snapshots, additive cell fields."""
import time

import pytest
from sqlalchemy import select, update

from backend.models_ops import Measure, MeasureCell, MeasureEvent, RiskSnapshot, utcnow
from backend.tests.conftest import OPS_CELLS, OPS_PARENT, auth, jpeg_bytes, make_measure

TOP2 = OPS_CELLS[-2:]                       # risk scores 48 and 49


def upload(client, headers, mid, kind="after", color=(10, 20, 30)):
    return client.post(f"/api/measures/{mid}/evidence", headers=headers, data={"kind": kind, "caption": "c"},
                       files={"file": ("p.jpg", jpeg_bytes(color=color), "image/jpeg")})


def progress(client, headers):
    r = client.get(f"/api/regions/h3_parent/{OPS_PARENT}/progress", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def move(client, headers, mid, status, note=None):
    return client.patch(f"/api/measures/{mid}", json={"status": status, **({"note": note} if note else {})}, headers=headers)


# ---------------------------------------------------------------- create
def test_create_measure_defaults_and_snapshot(ops):
    h = auth(ops, "engineer")
    m = make_measure(ops, h, cells=TOP2)
    assert m["status"] == "planned" and m["owner_role"] == "engineer"          # default_owner of street_lighting
    assert m["effect_weight"] == 0.10 and m["created_by"] == "demo-engineer" and m["cell_ids"] == sorted(TOP2)
    assert m["category_label"].startswith("Street lighting") and m["evidence_required"] == ["before", "after"]
    d = ops.get(f"/api/measures/{m['id']}", headers=h).json()
    assert [e["type"] for e in d["events"]] == ["created"] and d["evidence"] == []
    p = progress(ops, h)
    assert len(p["snapshots"]) == 1 and p["snapshots"][0]["cause_measure_id"] == m["id"]


def test_create_owner_can_be_overridden_and_planner_creates_planned(ops):
    m = make_measure(ops, auth(ops, "planner"), owner_role="engineer", source="chat", report_id="WMK-20200101-ABCDEF")
    assert m["owner_role"] == "engineer" and m["status"] == "planned" and m["source"] == "chat"
    assert m["report_id"] is None                                                # unknown report ids are not linked


@pytest.mark.parametrize("patch,code", [
    ({"category": "teleporters"}, "unknown_category"),
    ({"cell_ids": ["nope"]}, "unknown_cells"),
    ({"cell_ids": ["89446ca9dc3ffff"]}, "unknown_cells"),
])
def test_create_validation(ops, patch, code):
    body = {"region_kind": "h3_parent", "region_key": OPS_PARENT, "title": "Something useful", "category": "street_lighting",
            "cell_ids": TOP2} | patch
    r = ops.post("/api/measures", json=body, headers=auth(ops))
    assert r.status_code == 422 and r.json()["detail"]["code"] == code


def test_create_rejects_cells_outside_region_and_missing_fields(ops):
    from backend.tests.conftest import OTHER_CELLS
    body = {"region_kind": "h3_parent", "region_key": OPS_PARENT, "title": "Something useful", "category": "street_lighting",
            "cell_ids": [OTHER_CELLS[0]]}
    r = ops.post("/api/measures", json=body, headers=auth(ops))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "cells_outside_region"
    assert ops.post("/api/measures", json={"title": "x"}, headers=auth(ops)).status_code == 422
    assert ops.post("/api/measures", json=body | {"cell_ids": []}, headers=auth(ops)).status_code == 422
    assert ops.post("/api/measures", json=body).status_code == 401


# ---------------------------------------------------------------- the full walk with exact numbers
def test_full_walk_changes_the_numbers_correctly(ops):
    eng, pln, com = auth(ops, "engineer"), auth(ops, "planner"), auth(ops, "community")
    m = make_measure(ops, eng, cells=TOP2)
    mid = m["id"]
    p = progress(ops, eng)
    assert (p["implementation_pct"], p["verified_pct"], p["base_index"], p["adjusted_index"]) == (0.0, 0.0, 25.0, 25.0)
    assert p["credit_cap"] == 0.6 and p["placeholder_weights"] is True and "not a re-run" in p["note"]

    assert move(ops, eng, mid, "in_progress").status_code == 200
    p = progress(ops, eng)
    assert p["implementation_pct"] == 25.0 and p["verified_pct"] == 0.0 and p["adjusted_index"] == 25.0

    r = upload(ops, eng, mid, "after")                                           # auto-advance
    assert r.status_code == 201
    d = ops.get(f"/api/measures/{mid}", headers=eng).json()
    assert d["status"] == "evidence_submitted"
    p = progress(ops, eng)
    assert p["implementation_pct"] == 75.0 and p["verified_pct"] == 0.0
    assert p["adjusted_index"] == 25.0                                           # evidence never changes the adjusted index

    assert ops.post(f"/api/measures/{mid}/verify", json={"decision": "approve"}, headers=eng).status_code == 403
    r = ops.post(f"/api/measures/{mid}/verify", json={"decision": "reject", "reason": "Photo is too dark"}, headers=pln)
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    assert progress(ops, eng)["implementation_pct"] == 25.0

    assert upload(ops, eng, mid, "after", color=(99, 98, 97)).status_code == 201
    assert ops.get(f"/api/measures/{mid}", headers=eng).json()["status"] == "evidence_submitted"

    r = ops.post(f"/api/measures/{mid}/verify", json={"decision": "approve"}, headers=pln)
    assert r.status_code == 200 and r.json()["status"] == "verified"
    p = progress(ops, eng)
    assert p["implementation_pct"] == 100.0 and p["verified_pct"] == 100.0
    # cells 48 and 49 each lose 10%: (1225 - 4.8 - 4.9) / 49 = 24.802 -> 24.8
    assert p["base_index"] == 25.0 and p["adjusted_index"] == 24.8 and p["projected_index"] == 24.8
    assert 0 < p["adjusted_index"] < p["base_index"]

    types = [e["type"] for e in ops.get(f"/api/measures/{mid}", headers=eng).json()["events"]]
    assert types.count("transition") == 3 and types.count("reject") == 1 and types.count("verify") == 1
    assert types.count("evidence") == 2 and types[0] == "created"
    snaps = p["snapshots"]
    assert len(snaps) == 6 and snaps[0]["adjusted_index"] == 25.0 and snaps[-1]["adjusted_index"] == 24.8
    assert [s["verified_pct"] for s in snaps] == [0.0, 0.0, 0.0, 0.0, 0.0, 100.0]

    # additive fields on the cell endpoints
    top = TOP2[-1]
    c = ops.get(f"/api/cells/{top}").json()
    assert c["risk_score"] == 49.0 and c["adjusted_risk_score"] == pytest.approx(44.1) and c["has_measures"] is True
    assert c["projected_risk_score"] == pytest.approx(44.1)
    assert c["measures"] == [{"id": mid, "title": m["title"], "status": "verified", "category": "street_lighting",
                              "region_kind": "h3_parent", "region_key": OPS_PARENT}]
    other = ops.get(f"/api/cells/{OPS_CELLS[0]}").json()
    assert other["adjusted_risk_score"] == other["risk_score"] == other["projected_risk_score"] == 1.0
    assert other["has_measures"] is False and other["measures"] == []
    lst = {i["cell_id"]: i for i in ops.get("/api/cells").json()["items"]}
    assert lst[top]["adjusted_risk_score"] == pytest.approx(44.1) and lst[top]["has_measures"] is True
    assert lst[top]["projected_risk_score"] == pytest.approx(44.1)
    assert lst[OPS_CELLS[5]]["has_measures"] is False and lst[OPS_CELLS[5]]["measures"] == []


def test_unverified_measure_never_lowers_the_adjusted_score(ops):
    h = auth(ops, "engineer")
    m = make_measure(ops, h, cells=TOP2)
    move(ops, h, m["id"], "in_progress")
    upload(ops, h, m["id"], "after")
    c = ops.get(f"/api/cells/{TOP2[-1]}").json()
    assert c["adjusted_risk_score"] == c["risk_score"] == 49.0 and c["has_measures"] is True
    assert c["projected_risk_score"] == pytest.approx(47.78)


def test_projected_score_moves_with_progress_while_confirmed_score_waits_for_verification(ops, roles):
    engineer, planner = roles["engineer"], roles["planner"]
    m = make_measure(ops, engineer, category="street_lighting", cells=[TOP2[-1]])
    cell_url = f"/api/cells/{TOP2[-1]}"

    planned = ops.get(cell_url).json()
    assert planned["risk_score"] == planned["adjusted_risk_score"] == planned["projected_risk_score"] == 49.0

    assert move(ops, engineer, m["id"], "in_progress").status_code == 200
    in_progress = ops.get(cell_url).json()
    assert in_progress["risk_score"] == in_progress["adjusted_risk_score"] == 49.0
    assert in_progress["projected_risk_score"] == pytest.approx(47.78)

    assert upload(ops, engineer, m["id"], "after").status_code == 201
    submitted = ops.get(cell_url).json()
    assert submitted["adjusted_risk_score"] == 49.0
    assert submitted["projected_risk_score"] == pytest.approx(45.33)

    assert ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=planner).status_code == 200
    verified = ops.get(cell_url).json()
    assert verified["adjusted_risk_score"] == verified["projected_risk_score"] == pytest.approx(44.1)
    p = progress(ops, planner)
    assert p["projected_index"] == p["adjusted_index"]


# ---------------------------------------------------------------- state machine
@pytest.mark.parametrize("start,target", [
    ("planned", "verified"), ("planned", "evidence_submitted"), ("planned", "planned"),
    ("in_progress", "planned"), ("in_progress", "verified"), ("in_progress", "in_progress"),
])
def test_illegal_transitions_are_409_with_allowed_list(ops, start, target):
    h = auth(ops, "planner")
    m = make_measure(ops, h)
    if start == "in_progress":
        assert move(ops, h, m["id"], "in_progress").status_code == 200
    r = move(ops, h, m["id"], target)
    assert r.status_code == 409, r.text
    d = r.json()["detail"]
    assert d["code"] == "illegal_transition" and d["allowed"] == {"planned": ["in_progress"], "in_progress": ["evidence_submitted"]}[start]


def test_evidence_submitted_cannot_go_back_to_planned_and_verified_is_final(ops):
    eng, pln = auth(ops, "engineer"), auth(ops, "planner")
    m = make_measure(ops, eng)
    move(ops, eng, m["id"], "in_progress")
    upload(ops, eng, m["id"], "after")
    r = move(ops, pln, m["id"], "planned")
    assert r.status_code == 409 and r.json()["detail"]["allowed"] == ["verified", "in_progress"]
    assert ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=pln).status_code == 200
    r = move(ops, pln, m["id"], "in_progress")
    assert r.status_code == 409 and r.json()["detail"]["allowed"] == []
    assert ops.delete(f"/api/measures/{m['id']}", headers=pln).status_code == 409           # verified is final
    assert upload(ops, eng, m["id"], "after", color=(1, 1, 1)).status_code == 409


def test_community_cannot_change_status_but_can_comment(ops):
    com, eng = auth(ops, "community"), auth(ops, "engineer")
    m = make_measure(ops, eng)
    r = move(ops, com, m["id"], "in_progress")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "forbidden"
    c = ops.post(f"/api/measures/{m['id']}/comments", json={"text": "Seen near the school"}, headers=com)
    assert c.status_code == 201 and c.json()["type"] == "comment" and c.json()["actor_role"] == "community"
    assert ops.post(f"/api/measures/{m['id']}/comments", json={"text": ""}, headers=com).status_code == 422
    d = ops.get(f"/api/measures/{m['id']}", headers=eng).json()
    assert d["events"][-1]["note"] == "Seen near the school"
    assert d["allowed_next"] == ["in_progress"]                                  # for an engineer
    assert ops.get(f"/api/measures/{m['id']}", headers=com).json()["allowed_next"] == []


def test_manual_submit_needs_evidence(ops):
    eng = auth(ops, "engineer")
    m = make_measure(ops, eng)
    move(ops, eng, m["id"], "in_progress")
    r = move(ops, eng, m["id"], "evidence_submitted")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "evidence_required"
    assert upload(ops, eng, m["id"], "before").status_code == 201                # a 'before' photo does not auto-advance
    assert ops.get(f"/api/measures/{m['id']}", headers=eng).json()["status"] == "in_progress"
    assert move(ops, eng, m["id"], "evidence_submitted").status_code == 200


def test_approve_requires_an_after_photo(ops):
    eng, pln = auth(ops, "engineer"), auth(ops, "planner")
    m = make_measure(ops, eng)
    move(ops, eng, m["id"], "in_progress")
    upload(ops, eng, m["id"], "before")
    move(ops, eng, m["id"], "evidence_submitted")
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=pln)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "evidence_required"


def test_reject_needs_a_reason_and_returns_to_in_progress(ops):
    eng, pln = auth(ops, "engineer"), auth(ops, "planner")
    m = make_measure(ops, eng)
    move(ops, eng, m["id"], "in_progress")
    upload(ops, eng, m["id"], "after")
    for body in ({"decision": "reject"}, {"decision": "reject", "reason": "   "}):
        r = ops.post(f"/api/measures/{m['id']}/verify", json=body, headers=pln)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "reason_required"
    assert move(ops, pln, m["id"], "in_progress").status_code == 422                 # PATCH route needs the note too
    r = move(ops, pln, m["id"], "in_progress", note="Wrong junction")
    assert r.status_code == 200 and r.json()["status"] == "in_progress"
    ev = r.json()["events"][-1]
    assert ev["type"] == "reject" and ev["note"] == "Wrong junction" and ev["from_status"] == "evidence_submitted"


def test_verify_route_checks_state(ops):
    pln = auth(ops, "planner")
    m = make_measure(ops, auth(ops, "engineer"))
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=pln)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "illegal_transition"
    assert ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "maybe"}, headers=pln).status_code == 422
    assert ops.post("/api/measures/9999/verify", json={"decision": "approve"}, headers=pln).status_code == 404


# ---------------------------------------------------------------- self-verification
def test_creator_cannot_verify_their_own_measure(ops):
    pln, eng = auth(ops, "planner"), auth(ops, "engineer")
    m = make_measure(ops, pln)                                                   # created by demo-planner
    move(ops, pln, m["id"], "in_progress")
    upload(ops, eng, m["id"], "after")
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=pln)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "self_verification"
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "reject", "reason": "x"}, headers=pln)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "self_verification"
    # a different planner account (real login, different id) may review it
    other = auth(ops, demo=False, username="planner", password="waymark-planner")
    assert ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=other).status_code == 200


def test_uploader_cannot_verify_even_if_they_did_not_create(ops):
    eng, pln = auth(ops, "engineer"), auth(ops, "planner")
    m = make_measure(ops, eng)
    move(ops, eng, m["id"], "in_progress")
    assert upload(ops, pln, m["id"], "after").status_code == 201                  # the planner uploads the evidence
    assert ops.get(f"/api/measures/{m['id']}", headers=eng).json()["status"] == "evidence_submitted"
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=pln)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "self_verification"
    assert "created or whose evidence you uploaded" in r.json()["detail"]["message"]


# ---------------------------------------------------------------- weights, multiplication, cap, cancel
def _verified(ops, headers_by_role, category, cells, weight=None):
    m = make_measure(ops, headers_by_role["engineer"], category=category, cells=cells)
    move(ops, headers_by_role["engineer"], m["id"], "in_progress")
    upload(ops, headers_by_role["engineer"], m["id"], "after", color=(m["id"], 5, 9))
    if weight is not None:
        with ops.S() as db:
            db.execute(update(Measure).where(Measure.id == m["id"]).values(effect_weight_snapshot=weight))
            db.commit()
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=headers_by_role["planner"])
    assert r.status_code == 200, r.text
    return m


@pytest.fixture()
def roles(ops):
    return {r: auth(ops, r) for r in ("planner", "engineer", "community")}


def test_two_verified_measures_on_one_cell_multiply(ops, roles):
    _verified(ops, roles, "street_lighting", [OPS_CELLS[-1]])                     # 0.10
    _verified(ops, roles, "junction_layout", [OPS_CELLS[-1]])                     # 0.12
    c = ops.get(f"/api/cells/{OPS_CELLS[-1]}").json()
    assert c["adjusted_risk_score"] == pytest.approx(round(49 * (1 - (1 - 0.9 * 0.88)), 2))          # 38.81, not 49 * 0.78
    assert len(c["measures"]) == 2


def test_credit_cap_applies(ops, roles):
    _verified(ops, roles, "street_lighting", [OPS_CELLS[-1]], weight=0.5)
    _verified(ops, roles, "junction_layout", [OPS_CELLS[-1]], weight=0.5)
    assert ops.get(f"/api/cells/{OPS_CELLS[-1]}").json()["adjusted_risk_score"] == pytest.approx(49 * 0.4)   # 0.75 capped to 0.6


def test_snapshot_weight_is_used_not_the_live_config(ops, roles):
    _verified(ops, roles, "street_lighting", [OPS_CELLS[-1]], weight=0.3)          # config still says 0.10
    assert ops.get(f"/api/cells/{OPS_CELLS[-1]}").json()["adjusted_risk_score"] == pytest.approx(49 * 0.7)


def test_zero_weight_category_verifies_but_changes_nothing(ops, roles):
    _verified(ops, roles, "site_safety_audit", TOP2)
    p = progress(ops, roles["planner"])
    assert p["verified_pct"] == 100.0 and p["adjusted_index"] == p["base_index"] == 25.0


def test_cancelled_measures_drop_out_of_the_numbers(ops, roles):
    a = make_measure(ops, roles["engineer"], cells=TOP2)
    b = make_measure(ops, roles["engineer"], cells=TOP2, title="Second measure")
    move(ops, roles["engineer"], a["id"], "in_progress")
    assert progress(ops, roles["engineer"])["implementation_pct"] == 12.5          # (0.25 + 0) / 2
    r = ops.delete(f"/api/measures/{a['id']}", headers=roles["engineer"])
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    p = progress(ops, roles["engineer"])
    assert [x["id"] for x in p["measures"]] == [b["id"]] and p["implementation_pct"] == 0.0
    assert ops.delete(f"/api/measures/{a['id']}", headers=roles["engineer"]).status_code == 409
    assert ops.get(f"/api/cells/{TOP2[0]}").json()["measures"][0]["id"] == b["id"]
    assert ops.delete(f"/api/measures/{b['id']}", headers=roles["community"]).status_code == 403


def test_edit_fields_and_locks(ops, roles):
    m = make_measure(ops, roles["engineer"])
    r = ops.patch(f"/api/measures/{m['id']}", json={"title": "Better title here"}, headers=roles["engineer"])
    assert r.status_code == 200 and r.json()["title"] == "Better title here"
    assert ops.patch(f"/api/measures/{m['id']}", json={"title": "Wrong owner"}, headers=roles["community"]).status_code == 403
    assigned = ops.patch(f"/api/measures/{m['id']}", json={"owner_role": "planner"}, headers=roles["planner"])
    assert assigned.status_code == 200 and assigned.json()["owner_role"] == "planner"
    other = auth(ops, demo=False, username="community", password="waymark-community")
    assert ops.patch(f"/api/measures/{m['id']}", json={"title": "Hijacked title"}, headers=other).status_code == 403
    assert ops.patch(f"/api/measures/{m['id']}", json={"title": "ab"}, headers=roles["community"]).status_code == 422
    assert ops.patch(f"/api/measures/{m['id']}", json={"status": "cancelled"}, headers=roles["planner"]).status_code == 409


def test_effects_endpoint_lists_categories_and_flags_placeholders(ops):
    d = ops.get("/api/effects", headers=auth(ops, "community")).json()
    assert d["placeholder_weights"] is True and d["credit_cap"] == 0.6
    ids = {c["id"] for c in d["categories"]}
    assert {"street_lighting", "site_safety_audit"} <= ids and all(c["placeholder"] for c in d["categories"])


def test_progress_for_unknown_region_and_other_region_isolation(ops, roles):
    make_measure(ops, roles["engineer"])
    assert ops.get("/api/regions/h3_parent/nonsense/progress", headers=roles["planner"]).status_code == 404
    assert ops.get(f"/api/regions/bbox/29.0,-96.0,31.0,-95.0/progress", headers=roles["planner"]).json()["measures"] == []
    assert ops.get(f"/api/regions/h3_parent/{OPS_PARENT}/progress").status_code == 401


def test_progress_with_200_measures_is_fast(ops, roles):
    with ops.S() as db:
        for i in range(200):
            m = Measure(region_kind="h3_parent", region_key=OPS_PARENT, title=f"M{i}", category="street_lighting",
                        owner_role="engineer", status=("planned", "in_progress", "evidence_submitted", "verified")[i % 4],
                        effect_weight_snapshot=0.1, source="manual", created_by="x", created_at=utcnow(), updated_at=utcnow())
            db.add(m)
            db.flush()
            db.add(MeasureCell(measure_id=m.id, cell_id=OPS_CELLS[i % 49]))
        db.commit()
    t = time.perf_counter()
    p = progress(ops, roles["planner"])
    elapsed = time.perf_counter() - t
    assert len(p["measures"]) == 200 and p["implementation_pct"] == pytest.approx(50.0) and p["verified_pct"] == 25.0
    assert elapsed < 0.5, f"progress took {elapsed:.2f}s"


def test_summary_reports_overlay_info_additively(ops):
    d = ops.get("/api/summary").json()
    assert d["placeholder_weights"] is True and d["credit_cap"] == 0.6 and "cells_scored" in d and "headline" in d
