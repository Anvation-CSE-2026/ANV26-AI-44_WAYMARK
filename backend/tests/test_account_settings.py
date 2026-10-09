from backend.auth import ROLE_LABELS, Role, hash_password
from backend.models_ops import Account, create_ops_tables
from sqlalchemy import create_engine, inspect


def registered_account(ops):
    with ops.S() as db:
        account = Account(id="varshith@example.com", name="Varshith C", password_hash=hash_password("old-pass-123"),
                          role=Role.engineer.value)
        db.add(account)
        db.commit()


def test_profile_can_be_read_and_name_updated(ops):
    registered_account(ops)
    login = ops.post("/api/auth/login", json={"username": "varshith@example.com", "password": "old-pass-123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    profile = ops.get("/api/auth/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json() == {"id": "varshith@example.com", "name": "Varshith C", "role": "engineer"}

    updated = ops.patch("/api/auth/profile", json={"name": "  Varshith Kumar  "}, headers=headers)
    assert updated.status_code == 200
    assert updated.json() == {"id": "varshith@example.com", "name": "Varshith Kumar", "role": "engineer"}


def test_password_change_requires_current_password_and_revokes_all_tokens(ops):
    registered_account(ops)
    login = ops.post("/api/auth/login", json={"username": "varshith@example.com", "password": "old-pass-123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    second_login = ops.post("/api/auth/login", json={"username": "varshith@example.com", "password": "old-pass-123"})
    second_headers = {"Authorization": f"Bearer {second_login.json()['access_token']}"}

    wrong = ops.post("/api/auth/change-password", json={
        "current_password": "wrong-password", "new_password": "new-pass-123",
    }, headers=headers)
    assert wrong.status_code == 400

    changed = ops.post("/api/auth/change-password", json={
        "current_password": "old-pass-123", "new_password": "new-pass-123",
    }, headers=headers)
    assert changed.status_code == 200
    assert ops.get("/api/auth/me", headers=headers).status_code == 401
    assert ops.get("/api/auth/me", headers=second_headers).status_code == 401
    assert ops.post("/api/auth/login", json={"username": "varshith@example.com", "password": "old-pass-123"}).status_code == 401
    new_login = ops.post("/api/auth/login", json={"username": "varshith@example.com", "password": "new-pass-123"})
    assert new_login.status_code == 200


def test_profile_and_password_routes_reject_demo_accounts(ops):
    token = ops.post("/api/auth/demo", json={"role": "engineer"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert ops.get("/api/auth/me", headers=headers).status_code == 403
    assert ops.patch("/api/auth/profile", json={"name": "Changed"}, headers=headers).status_code == 403
    assert ops.post("/api/auth/change-password", json={
        "current_password": "demo", "new_password": "new-pass-123",
    }, headers=headers).status_code == 403


def test_workspace_labels_match_role_ids():
    assert ROLE_LABELS == {
        Role.planner: "City Planners",
        Role.engineer: "Road Authorities",
        Role.community: "Traffic Police",
    }


def test_existing_accounts_table_gets_session_version_column():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE accounts (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, "
            "password_hash VARCHAR NOT NULL, role VARCHAR NOT NULL DEFAULT 'community')"
        )
    create_ops_tables(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("accounts")}
    assert "session_version" in columns
    engine.dispose()
