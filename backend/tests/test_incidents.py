from datetime import datetime, timezone

from backend.tests.conftest import OPS_CELLS, auth, make_measure


def test_police_reports_pending_activity_planner_reviews_without_changing_model_score(ops):
    police, planner, roads = auth(ops, "community"), auth(ops, "planner"), auth(ops, "engineer")
    with ops.S() as db:
        cell = db.get(__import__("backend.models", fromlist=["Cell"]).Cell, OPS_CELLS[0])
        point = {"lat": cell.lat, "lng": cell.lng}
    baseline = ops.get(f"/api/cells/{OPS_CELLS[0]}").json()["risk_score"]
    body = {"kind": "crash", **point, "occurred_at": "2026-10-09T10:00:00Z", "severity": 3, "note": "Signal timing observation"}
    assert ops.post("/api/incidents", json=body, headers=planner).status_code == 403
    created = ops.post("/api/incidents", json=body, headers=police)
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["status"] == "pending" and report["cell_id"] == OPS_CELLS[0]
    assert ops.get(f"/api/incidents?cell_id={OPS_CELLS[0]}", headers=roads).json()["count"] == 0
    assert ops.get(f"/api/incidents?cell_id={OPS_CELLS[0]}", headers=planner).json()["count"] == 1
    cell_row = ops.get(f"/api/cells/{OPS_CELLS[0]}").json()
    assert cell_row["incident_pending_count"] == 1 and cell_row["incident_confirmed_count"] == 0
    assert cell_row["risk_score"] == baseline
    assert ops.post(f"/api/incidents/{report['id']}/review", json={"decision": "confirm"}, headers=roads).status_code == 403
    reviewed = ops.post(f"/api/incidents/{report['id']}/review", json={"decision": "confirm"}, headers=planner)
    assert reviewed.status_code == 200 and reviewed.json()["status"] == "confirmed"
    cell_row = ops.get(f"/api/cells/{OPS_CELLS[0]}").json()
    assert cell_row["incident_pending_count"] == 0 and cell_row["incident_confirmed_count"] == 1
    assert cell_row["risk_score"] == baseline
    assert ops.get(f"/api/incidents?cell_id={OPS_CELLS[0]}", headers=roads).json()["count"] == 1


def test_cell_location_labels_are_in_list_and_detail(ops):
    listed = {row["cell_id"]: row for row in ops.get("/api/cells").json()["items"]}
    detail = ops.get(f"/api/cells/{OPS_CELLS[0]}").json()
    assert listed[OPS_CELLS[0]]["street_name"] == "Main St"
    assert listed[OPS_CELLS[0]]["locality"] == "Houston"
    assert detail["street_name"] == "Main St"
    assert detail["locality"] == "Houston"


def test_near_miss_rejection_and_measure_role_ownership(ops):
    police, planner, roads = auth(ops, "community"), auth(ops, "planner"), auth(ops, "engineer")
    with ops.S() as db:
        from backend.models import Cell
        cell = db.get(Cell, OPS_CELLS[1])
        point = {"lat": cell.lat, "lng": cell.lng}
    report = ops.post("/api/incidents", json={"kind": "near_miss", **point,
                        "occurred_at": datetime.now(timezone.utc).isoformat(), "note": "Near miss at crossing"},
                      headers=police).json()
    assert report["severity"] is None
    assert ops.post(f"/api/incidents/{report['id']}/review", json={"decision": "reject"}, headers=planner).status_code == 422
    rejected = ops.post(f"/api/incidents/{report['id']}/review", json={"decision": "reject", "note": "Duplicate"}, headers=planner)
    assert rejected.status_code == 200 and rejected.json()["status"] == "rejected"

    measure = make_measure(ops, planner, owner_role="planner", cells=OPS_CELLS[:1])
    assert ops.patch(f"/api/measures/{measure['id']}", json={"status": "in_progress"}, headers=roads).status_code == 403
    assert ops.patch(f"/api/measures/{measure['id']}", json={"progress_note": "Blocked"}, headers=roads).status_code == 403
    assert ops.post("/api/measures", json={"region_kind": "h3_parent", "region_key": "x", "title": "Nope",
                                           "category": "street_lighting", "cell_ids": OPS_CELLS[:1]},
                    headers=police).status_code == 403


def test_road_authority_can_update_own_measure_plan(ops):
    roads = auth(ops, "engineer")
    measure = make_measure(ops, roads, cells=OPS_CELLS[:1])
    response = ops.patch(f"/api/measures/{measure['id']}", json={
        "due_at": "2026-12-01T12:00:00Z", "progress_note": "Crew scheduled"
    }, headers=roads)
    assert response.status_code == 200, response.text
    assert response.json()["progress_note"] == "Crew scheduled"
    assert response.json()["due_at"].startswith("2026-12-01T12:00:00")
