def test_crashes_in_bbox(client):
    r = client.get("/api/crashes", params={"bbox": "29.69,-95.42,29.72,-95.38"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["total"] == 1 and body["count"] == 1 and body["truncated"] is False
    c = body["items"][0]
    assert c["crash_id"] == "C1" and c["cell_id"] == "EM1" and c["weather"] == "Rain" and c["night"] is False


def test_crashes_by_cell_and_limit(client):
    r = client.get("/api/crashes", params={"cell_id": "BIG"})
    assert r.json()["count"] == 1 and r.json()["items"][0]["night"] is True
    r = client.get("/api/crashes", params={"bbox": "29,-96,30,-95", "limit": 1})
    assert r.json()["total"] == 2 and r.json()["count"] == 1 and r.json()["truncated"] is True


def test_crashes_need_a_filter_and_validate_bbox(client):
    assert client.get("/api/crashes").json()["count"] == 0
    assert client.get("/api/crashes", params={"bbox": "bad"}).status_code == 422
