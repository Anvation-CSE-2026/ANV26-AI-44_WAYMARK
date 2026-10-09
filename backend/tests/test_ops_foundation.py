"""S0: configuration, permissions, auth, CORS, models and the load_db guard."""
import json
import sys
import time

import jwt
import pytest
from sqlalchemy import inspect

from backend.auth import Role, hash_password, verify_password
from backend.config import settings
from backend.config_loader import ConfigError, load_effects, parse_effects
from backend.permissions import PERMISSIONS, can
from backend.tests.conftest import auth

GOOD = {
    "placeholder": True, "credit_cap": 0.5,
    "stage_factors": {"planned": 0, "in_progress": 0.2, "evidence_submitted": 0.7, "verified": 1.0},
    "categories": {"a": {"label": "A", "weight": 0.1, "default_owner": "engineer", "evidence_required": ["after"]}},
}


def bad(**changes):
    d = json.loads(json.dumps(GOOD))
    for path, value in changes.items():
        node = d
        *parents, last = path.split(".")
        for p in parents:
            node = node[p]
        if value is KeyError:
            del node[last]
        else:
            node[last] = value
    return d


# ---------------------------------------------------------------- effects.json
def test_shipped_effects_file_is_valid_and_flagged_placeholder():
    e = load_effects()
    assert e.placeholder is True and 5 <= len(e.categories) <= 9
    assert all(c.placeholder for c in e.categories.values())
    assert e.stage_factors["verified"] == 1.0 and 0 < e.credit_cap <= 1


def test_effects_valid_minimal_file():
    e = parse_effects(GOOD)
    assert e.credit_cap == 0.5 and e.categories["a"].default_owner == "engineer"


@pytest.mark.parametrize("changes,fragment", [
    ({"credit_cap": 0}, "credit_cap"),
    ({"credit_cap": 1.5}, "credit_cap"),
    ({"credit_cap": KeyError}, "credit_cap"),
    ({"stage_factors.in_progress": 0.9}, "must not decrease"),
    ({"stage_factors.verified": 0.9}, "exactly 1.0"),
    ({"stage_factors.planned": KeyError}, "stage_factors.planned"),
    ({"categories.a.weight": 1.2}, "categories.a.weight"),
    ({"categories.a.weight": "high"}, "categories.a.weight"),
    ({"categories.a.default_owner": "boss"}, "default_owner"),
    ({"categories.a.evidence_required": ["video"]}, "evidence_required"),
    ({"categories.a.label": KeyError}, "categories.a.label"),
    ({"categories": {}}, "categories"),
])
def test_effects_errors_name_file_key_and_problem(changes, fragment):
    with pytest.raises(ConfigError) as e:
        parse_effects(bad(**changes))
    assert "effects.json" in str(e.value) and fragment in str(e.value)


def test_effects_file_not_json(tmp_path):
    p = tmp_path / "effects.json"
    p.write_text("{nope", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_effects(p)
    with pytest.raises(ConfigError, match="cannot read"):
        load_effects(tmp_path / "missing.json")


# ---------------------------------------------------------------- permissions
def test_permission_table_matches_spec():
    p, e, c = Role.planner, Role.engineer, Role.community
    expected = {
        "report.create": {p, e, c}, "report.read": {p, e, c}, "chat.use": {p, e, c}, "measure.create": {p, e},
        "measure.transition": {p, e}, "measure.comment": {p, e, c}, "evidence.upload": {p, e, c},
        "evidence.read": {p, e, c}, "measure.verify": {p},
        "incident.read": {p, e, c}, "incident.create": {c}, "incident.review": {p},
    }
    assert {k: set(v) for k, v in PERMISSIONS.items()} == expected
    assert can(Role.planner, "measure.verify") and not can(Role.engineer, "measure.verify")
    assert not can(Role.community, "measure.transition") and not can(Role.planner, "nonexistent.action")


# ---------------------------------------------------------------- auth
def test_password_hashing_round_trip():
    h = hash_password("s3cret", salt=b"0" * 16, iterations=1000)
    assert verify_password("s3cret", h) and not verify_password("S3cret", h) and not verify_password("x", "garbage")


def test_login_three_demo_accounts(ops):
    for user, role in (("planner", "planner"), ("engineer", "engineer"), ("community", "community")):
        r = ops.post("/api/auth/login", json={"username": user, "password": f"waymark-{user}"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["token_type"] == "bearer" and body["user"]["role"] == role
        claims = jwt.decode(body["access_token"], settings.jwt_secret, algorithms=["HS256"])
        assert claims["sub"] == user and claims["role"] == role and "name" in claims and "exp" in claims


def test_login_rejects_bad_credentials(ops):
    assert ops.post("/api/auth/login", json={"username": "planner", "password": "nope"}).status_code == 401
    assert ops.post("/api/auth/login", json={"username": "ghost", "password": "x"}).status_code == 401
    assert ops.post("/api/auth/login", json={"username": "planner"}).status_code == 422


def test_demo_token_and_switch_off(ops, monkeypatch):
    r = ops.post("/api/auth/demo", json={"role": "engineer"})
    assert r.status_code == 200
    claims = jwt.decode(r.json()["access_token"], settings.jwt_secret, algorithms=["HS256"])
    assert claims["sub"] == "demo-engineer" and claims["role"] == "engineer"
    assert ops.post("/api/auth/demo", json={"role": "wizard"}).status_code == 422
    monkeypatch.setattr(settings, "demo_mode", False)
    assert ops.post("/api/auth/demo", json={"role": "engineer"}).status_code == 404


def test_bad_expired_missing_tokens_are_401(ops):
    url = "/api/effects"
    assert ops.get(url).status_code == 401
    assert ops.get(url, headers={"Authorization": "Bearer garbage"}).status_code == 401
    expired = jwt.encode({"sub": "x", "role": "planner", "exp": int(time.time()) - 5}, settings.jwt_secret, algorithm="HS256")
    assert ops.get(url, headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    wrong_key = jwt.encode({"sub": "x", "role": "planner", "exp": int(time.time()) + 60}, "k" * 40, algorithm="HS256")
    assert ops.get(url, headers={"Authorization": f"Bearer {wrong_key}"}).status_code == 401
    bad_role = jwt.encode({"sub": "x", "role": "root", "exp": int(time.time()) + 60}, settings.jwt_secret, algorithm="HS256")
    assert ops.get(url, headers={"Authorization": f"Bearer {bad_role}"}).status_code == 401
    assert ops.get(url, headers=auth(ops, "community")).status_code == 200


def test_wrong_role_is_403(ops):
    from backend.tests.conftest import make_measure
    m = make_measure(ops, auth(ops, "engineer"))
    r = ops.post(f"/api/measures/{m['id']}/verify", json={"decision": "approve"}, headers=auth(ops, "community"))
    assert r.status_code == 403


def test_existing_public_endpoints_need_no_token(client):
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/cells").status_code == 200


# ---------------------------------------------------------------- CORS, models, guard
def test_cors_preflight_for_post_succeeds(ops):
    origin = settings.cors_origins[0]
    r = ops.options("/api/measures", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin
    for verb in ("POST", "PATCH", "DELETE", "GET"):
        assert verb in r.headers["access-control-allow-methods"]
    assert "authorization" in r.headers["access-control-allow-headers"].lower()
    r = ops.options("/api/measures", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers


def test_ops_tables_exist_and_original_tables_untouched(ops):
    names = set(inspect(ops.engine).get_table_names())
    assert {"reports", "measures", "measure_cells", "evidence", "measure_events", "chat_sessions", "chat_messages",
            "risk_snapshots", "cells", "crashes"} <= names
    cols = {c["name"] for c in inspect(ops.engine).get_columns("cells")}
    assert "adjusted_risk_score" not in cols                       # the overlay is computed, never stored on cells


def test_load_db_refuses_to_overwrite_without_force(tmp_path, monkeypatch):
    from pipeline import load_db
    db = tmp_path / "waymark.db"
    db.write_bytes(b"precious")
    monkeypatch.setattr(sys, "argv", ["load_db.py", "--db", str(db), "--out", str(tmp_path)])
    with pytest.raises(SystemExit) as e:
        load_db.main()
    assert "--force" in str(e.value) and "measures" in str(e.value)
    assert db.read_bytes() == b"precious"
