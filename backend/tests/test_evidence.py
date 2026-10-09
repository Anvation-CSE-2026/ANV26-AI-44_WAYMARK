"""S3: evidence upload pipeline: validation, EXIF flags, re-encode, storage, authenticated download."""
import io
from datetime import datetime, timedelta

import h3
import pytest
from PIL import Image
from sqlalchemy import select

from backend import evidence_service
from backend.config import settings
from backend.models_ops import Evidence, MeasureEvent
from backend.tests.conftest import OPS_CELLS, auth, jpeg_bytes, make_measure

CELL = OPS_CELLS[10]
CLAT, CLNG = h3.cell_to_latlng(CELL)


def dms(value: float):
    v = abs(value)
    d = int(v)
    m = int((v - d) * 60)
    return (float(d), float(m), round((v - d - m / 60) * 3600, 4))


def exif_jpeg(lat=None, lng=None, taken=None, orientation=None, size=(64, 48), extra=b"") -> bytes:
    exif = Image.Exif()
    if taken is not None:
        exif.get_ifd(0x8769)[0x9003] = taken.strftime("%Y:%m:%d %H:%M:%S")
    if lat is not None:
        g = exif.get_ifd(0x8825)
        g[1], g[2] = ("N" if lat >= 0 else "S"), dms(lat)
        g[3], g[4] = ("E" if lng >= 0 else "W"), dms(lng)
    if orientation:
        exif[0x0112] = orientation
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 120, 60)).save(buf, format="JPEG", exif=exif)
    return buf.getvalue() + extra


def post(ops, headers, mid, data, filename="photo.jpg", ctype="image/jpeg", kind="before", caption=""):
    return ops.post(f"/api/measures/{mid}/evidence", headers=headers, data={"kind": kind, "caption": caption},
                    files={"file": (filename, data, ctype)})


@pytest.fixture()
def mm(ops):
    h = auth(ops, "engineer")
    m = make_measure(ops, h, cells=[CELL])
    return ops, h, m["id"]


# ---------------------------------------------------------------- validation
def test_sniff_by_magic_bytes_only():
    assert evidence_service.sniff(jpeg_bytes()) == "jpeg"
    buf = io.BytesIO(); Image.new("RGB", (4, 4)).save(buf, "PNG")
    assert evidence_service.sniff(buf.getvalue()) == "png"
    buf = io.BytesIO(); Image.new("RGB", (4, 4)).save(buf, "WEBP")
    assert evidence_service.sniff(buf.getvalue()) == "webp"
    assert evidence_service.sniff(b"%PDF-1.7 ...") is None and evidence_service.sniff(b"GIF89a....") is None
    assert evidence_service.sniff(b"<svg onload=alert(1)>") is None and evidence_service.sniff(b"") is None
    heic = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"
    assert evidence_service.sniff(heic) == ("heic" if evidence_service.HEIC_SUPPORTED else None)


@pytest.mark.parametrize("data,name,ctype", [
    (b"just some text", "notes.jpg", "image/jpeg"),                       # extension and Content-Type lie
    (b"%PDF-1.4 fake", "photo.jpg", "image/jpeg"),
    (b"GIF89a\x01\x00\x01\x00", "photo.gif", "image/gif"),
    (b"<html><script>alert(1)</script></html>", "photo.jpeg", "image/jpeg"),
    (b"", "empty.jpg", "image/jpeg"),
])
def test_wrong_type_is_415_whatever_the_name_says(mm, data, name, ctype):
    ops, h, mid = mm
    r = post(ops, h, mid, data, filename=name, ctype=ctype)
    assert r.status_code == 415 and r.json()["detail"]["code"] == "unsupported_type"


def test_correct_bytes_are_accepted_even_with_a_wrong_name_and_type(mm):
    ops, h, mid = mm
    buf = io.BytesIO(); Image.new("RGBA", (40, 30), (255, 0, 0, 128)).save(buf, "PNG")
    r = post(ops, h, mid, buf.getvalue(), filename="evidence.txt", ctype="text/plain")
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == "before" and r.json()["file_url"].endswith("/file")


def test_magic_bytes_with_garbage_body_is_415(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, b"\xff\xd8\xff\xe0" + b"\x00" * 200)
    assert r.status_code == 415


def test_oversize_is_413(mm, monkeypatch):
    ops, h, mid = mm
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    r = post(ops, h, mid, b"\xff\xd8\xff" + b"\0" * (1024 * 1024 + 10))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"
    assert post(ops, h, mid, jpeg_bytes()).status_code == 201                  # small files still pass


def test_decompression_bomb_is_415(mm, monkeypatch):
    ops, h, mid = mm
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    assert post(ops, h, mid, jpeg_bytes(size=(64, 48))).status_code == 415


def test_duplicate_per_measure_is_409_but_ok_on_another_measure(mm):
    ops, h, mid = mm
    data = jpeg_bytes(color=(5, 6, 7))
    assert post(ops, h, mid, data).status_code == 201
    r = post(ops, h, mid, data, kind="after")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "duplicate_evidence"
    other = make_measure(ops, h, cells=[CELL], title="Another measure")
    assert post(ops, h, other["id"], data).status_code == 201


def test_bad_kind_and_missing_things(mm):
    ops, h, mid = mm
    assert post(ops, h, mid, jpeg_bytes(), kind="video").status_code == 422
    assert post(ops, h, 9999, jpeg_bytes()).status_code == 404
    assert ops.post(f"/api/measures/{mid}/evidence", data={"kind": "before"},
                    files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}).status_code == 401
    assert ops.post(f"/api/measures/{mid}/evidence", headers=h, data={"kind": "before"}).status_code == 422


def test_rate_limit_per_user(mm, monkeypatch):
    ops, h, mid = mm
    monkeypatch.setattr(settings, "upload_rate_per_min", 3)
    codes = [post(ops, h, mid, jpeg_bytes(color=(40 * i + 20, 90, 7 * i))).status_code for i in range(5)]
    assert codes == [201, 201, 201, 429, 429]
    assert post(ops, auth(ops, "community"), mid, jpeg_bytes(color=(0, 9, 0))).status_code == 201   # another user is unaffected


# ---------------------------------------------------------------- storage safety
def test_client_filename_never_reaches_a_path(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, jpeg_bytes(), filename="../../../evil name<script>.jpg")
    assert r.status_code == 201
    row = r.json()
    assert row["caption"] == "evil namescript"                                     # sanitised stem used as caption fallback
    folder = settings.data_dir / "evidence" / str(mid)
    names = sorted(p.name for p in folder.iterdir())
    assert len(names) == 2 and all(n.endswith(".jpg") and "evil" not in n and ".." not in n for n in names)
    assert not (settings.data_dir.parent / "evil.jpg").exists()
    assert not any(p.name.startswith("evil") for p in settings.data_dir.rglob("*"))
    with ops.S() as db:
        e = db.scalar(select(Evidence).where(Evidence.id == row["id"]))
        assert len(e.file_name) == 36 and e.thumb_name.endswith("_thumb.jpg")


def test_explicit_caption_wins_and_is_cleaned(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, jpeg_bytes(), caption="Lamp\x00 fixed\n\tnow " + "x" * 300)
    assert r.json()["caption"].startswith("Lamp  fixed") and len(r.json()["caption"]) <= 200 and "\x00" not in r.json()["caption"]


def test_reencode_strips_metadata_and_trailing_payload_and_caps_size(mm):
    ops, h, mid = mm
    payload = b"<?php system($_GET['c']); ?>SECRETPAYLOAD"
    data = exif_jpeg(lat=CLAT, lng=CLNG, taken=datetime.utcnow(), size=(3000, 1000), extra=payload)
    r = post(ops, h, mid, data)
    assert r.status_code == 201
    stored = ops.get(r.json()["file_url"], headers=h)
    assert stored.status_code == 200 and b"SECRETPAYLOAD" not in stored.content and b"<?php" not in stored.content
    im = Image.open(io.BytesIO(stored.content))
    assert max(im.size) == 2000 and im.size == (2000, 667) and im.format == "JPEG"
    assert len(im.getexif()) == 0 and not im.getexif().get_ifd(0x8825)              # no EXIF, no GPS survives
    thumb = Image.open(io.BytesIO(ops.get(r.json()["thumb_url"], headers=h).content))
    assert max(thumb.size) == 320


def test_exif_orientation_is_applied_before_it_is_dropped(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, exif_jpeg(orientation=6, size=(100, 50)))                 # 6 = rotate 90 degrees
    im = Image.open(io.BytesIO(ops.get(r.json()["file_url"], headers=h).content))
    assert im.size == (50, 100)


# ---------------------------------------------------------------- EXIF flags
def test_geo_flag_ok_far_missing(mm):
    ops, h, mid = mm
    near = post(ops, h, mid, exif_jpeg(lat=CLAT + 0.002, lng=CLNG + 0.002, size=(70, 40)))
    far = post(ops, h, mid, exif_jpeg(lat=CLAT + 0.2, lng=CLNG, size=(71, 40)))
    none = post(ops, h, mid, exif_jpeg(size=(72, 40)))
    assert [near.json()["geo_flag"], far.json()["geo_flag"], none.json()["geo_flag"]] == ["ok", "far", "missing"]
    assert all(x.status_code == 201 for x in (near, far, none))                   # flags warn, never block


def test_geo_flag_threshold_is_configurable(mm, monkeypatch):
    ops, h, mid = mm
    data = exif_jpeg(lat=CLAT + 0.05, lng=CLNG)                                    # about 5.5 km away
    monkeypatch.setattr(settings, "geo_far_km", 10.0)
    assert post(ops, h, mid, data).json()["geo_flag"] == "ok"
    monkeypatch.setattr(settings, "geo_far_km", 1.0)
    assert post(ops, h, mid, exif_jpeg(lat=CLAT + 0.05, lng=CLNG, size=(65, 40))).json()["geo_flag"] == "far"


def test_southern_and_western_hemisphere_signs_are_handled():
    exif = Image.Exif()
    g = exif.get_ifd(0x8825)
    g[1], g[2], g[3], g[4] = "S", (33.0, 52.0, 0.0), "W", (151.0, 12.0, 0.0)
    buf = io.BytesIO(); Image.new("RGB", (8, 8)).save(buf, "JPEG", exif=exif)
    _, gps = evidence_service.read_exif(Image.open(io.BytesIO(buf.getvalue())))
    assert gps == pytest.approx((-33.8667, -151.2), abs=1e-3)


def test_stale_photo_flag(mm):
    ops, h, mid = mm
    old = post(ops, h, mid, exif_jpeg(taken=datetime.utcnow() - timedelta(days=90), size=(50, 40)))
    new = post(ops, h, mid, exif_jpeg(taken=datetime.utcnow() - timedelta(days=2), size=(51, 40)))
    no_time = post(ops, h, mid, exif_jpeg(size=(52, 40)))
    assert [x.json()["stale_photo"] for x in (old, new, no_time)] == [True, False, False]
    assert old.json()["exif_taken_at"] is not None and no_time.json()["exif_taken_at"] is None


def test_unreadable_exif_is_treated_as_missing(mm):
    ops, h, mid = mm
    exif = Image.Exif()
    exif.get_ifd(0x8769)[0x9003] = "not a date"
    g = exif.get_ifd(0x8825)
    g[1], g[2], g[3], g[4] = "N", (200.0, 0.0, 0.0), "E", (10.0, 0.0, 0.0)          # latitude 200 degrees: impossible
    buf = io.BytesIO(); Image.new("RGB", (30, 30), (1, 2, 3)).save(buf, "JPEG", exif=exif)
    r = post(ops, h, mid, buf.getvalue())
    assert r.status_code == 201 and r.json()["geo_flag"] == "missing" and r.json()["exif_taken_at"] is None


# ---------------------------------------------------------------- status effects and events
def test_after_photo_auto_advances_only_from_in_progress(mm):
    ops, h, mid = mm
    assert post(ops, h, mid, jpeg_bytes(color=(1, 1, 1)), kind="after").status_code == 201
    assert ops.get(f"/api/measures/{mid}", headers=h).json()["status"] == "planned"          # planned stays planned
    ops.patch(f"/api/measures/{mid}", json={"status": "in_progress"}, headers=h)
    assert post(ops, h, mid, jpeg_bytes(color=(2, 2, 2)), kind="during").status_code == 201
    assert ops.get(f"/api/measures/{mid}", headers=h).json()["status"] == "in_progress"       # 'during' does not advance
    assert post(ops, h, mid, jpeg_bytes(color=(3, 3, 3)), kind="after").status_code == 201
    d = ops.get(f"/api/measures/{mid}", headers=h).json()
    assert d["status"] == "evidence_submitted" and d["evidence_count"] == 3 and len(d["evidence"]) == 3
    kinds = [(e["type"], e["to_status"]) for e in d["events"]]
    assert ("transition", "evidence_submitted") in kinds and sum(1 for t, _ in kinds if t == "evidence") == 3
    ev = [e for e in d["events"] if e["type"] == "evidence"][-1]
    assert ev["actor"] == "demo-engineer" and ev["actor_role"] == "engineer" and "after" in ev["note"]


def test_upload_to_final_or_cancelled_measure_is_409(mm):
    ops, h, mid = mm
    ops.delete(f"/api/measures/{mid}", headers=h)
    r = post(ops, h, mid, jpeg_bytes())
    assert r.status_code == 409 and r.json()["detail"]["code"] == "locked"


# ---------------------------------------------------------------- download
def test_downloads_need_auth_and_send_private_cache_headers(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, jpeg_bytes())
    for url in (r.json()["file_url"], r.json()["thumb_url"]):
        assert ops.get(url).status_code == 401
        assert ops.get(url, headers={"Authorization": "Bearer nope"}).status_code == 401
        ok = ops.get(url, headers=auth(ops, "community"))
        assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
        assert "private" in ok.headers["cache-control"]
    assert ops.get("/api/evidence/9999/file", headers=h).status_code == 404
    assert ops.get("/api/evidence/abc/file", headers=h).status_code == 422


def test_missing_file_on_disk_is_404_not_500(mm):
    ops, h, mid = mm
    r = post(ops, h, mid, jpeg_bytes())
    for p in (settings.data_dir / "evidence" / str(mid)).iterdir():
        p.unlink()
    assert ops.get(r.json()["file_url"], headers=h).status_code == 404


def test_evidence_appears_in_measure_detail_with_flags(mm):
    ops, h, mid = mm
    post(ops, h, mid, exif_jpeg(lat=CLAT, lng=CLNG, taken=datetime.utcnow()), kind="before", caption="Before")
    e = ops.get(f"/api/measures/{mid}", headers=h).json()["evidence"][0]
    assert e["kind"] == "before" and e["geo_flag"] == "ok" and e["stale_photo"] is False and e["uploaded_by"] == "demo-engineer"
    assert e["file_url"] == f"/api/evidence/{e['id']}/file" and e["caption"] == "Before"
    with ops.S() as db:
        assert db.scalar(select(MeasureEvent.id).where(MeasureEvent.measure_id == mid, MeasureEvent.type == "evidence"))
