"""Evidence photo handling: magic-byte sniffing, EXIF read, geo / stale flags, safe re-encode, rate limit.

Order matters (see the README): sniff -> hash -> read EXIF -> flags -> re-encode (drops all metadata) -> store.
"""
from __future__ import annotations

import io
import math
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from PIL import Image, ImageOps, UnidentifiedImageError

from .config import settings

try:                                    # HEIC is optional (first item on the cut-list)
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:                       # pragma: no cover - depends on the environment
    HEIC_SUPPORTED = False

Image.MAX_IMAGE_PIXELS = 60_000_000     # decompression-bomb guard: Pillow raises above 2x this value

EXIF_DATETIME_ORIGINAL, EXIF_DATETIME, EXIF_IFD, GPS_IFD = 0x9003, 0x0132, 0x8769, 0x8825
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}


class BadImage(ValueError):
    """The upload is not an image this server accepts (message is safe to show)."""


# ------------------------------------------------------------------ sniffing
def sniff(data: bytes) -> Optional[str]:
    """Identify the format from the first bytes only. The file name and client Content-Type are never trusted."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if HEIC_SUPPORTED and data[4:8] == b"ftyp" and data[8:12] in HEIC_BRANDS:
        return "heic"
    return None


# ------------------------------------------------------------------ EXIF / flags
def _ratio(v) -> float:
    return float(v[0]) / float(v[1]) if isinstance(v, tuple) and len(v) == 2 and v[1] else float(v)


def _dms(values, ref) -> Optional[float]:
    try:
        d, m, s = (_ratio(x) for x in values)
        out = d + m / 60 + s / 3600
        return -out if str(ref).upper() in ("S", "W") else out
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def read_exif(im: Image.Image) -> tuple[Optional[datetime], Optional[tuple[float, float]]]:
    """(capture time, (lat, lng)) from EXIF, each None when absent or unreadable."""
    taken = gps = None
    try:
        exif = im.getexif()
        raw = exif.get_ifd(EXIF_IFD).get(EXIF_DATETIME_ORIGINAL) or exif.get(EXIF_DATETIME)
        if raw:
            taken = datetime.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
        g = exif.get_ifd(GPS_IFD)
        if g and 2 in g and 4 in g:
            lat, lng = _dms(g[2], g.get(1, "N")), _dms(g[4], g.get(3, "E"))
            if lat is not None and lng is not None and -90 <= lat <= 90 and -180 <= lng <= 180:
                gps = (lat, lng)
    except Exception:
        pass                              # unreadable EXIF is treated as missing; flags warn, they never block
    return taken, gps


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def geo_flag(gps: Optional[tuple[float, float]], cell_points: list[tuple[float, float]]) -> str:
    if gps is None:
        return "missing"
    if not cell_points:
        return "missing"
    nearest = min(haversine_km(gps[0], gps[1], lat, lng) for lat, lng in cell_points)
    return "ok" if nearest <= settings.geo_far_km else "far"


def is_stale(taken: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if taken is None:
        return False
    return ((now or datetime.utcnow()) - taken).days > settings.stale_photo_days


# ------------------------------------------------------------------ re-encode
@dataclass
class Processed:
    image_jpeg: bytes
    thumb_jpeg: bytes
    taken: Optional[datetime]
    gps: Optional[tuple[float, float]]


def _to_rgb(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def process_image(data: bytes) -> Processed:
    """Decode, read EXIF, then re-encode as a clean JPEG (no metadata, no trailing payload) plus a thumbnail."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            taken, gps = read_exif(im)
            im = ImageOps.exif_transpose(im)         # apply orientation before the metadata is dropped
            im = _to_rgb(im)
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, ValueError):
        raise BadImage("That file could not be read as a photo. Use a JPEG, PNG or WebP image.") from None

    big = im.copy()
    big.thumbnail((settings.image_max_side, settings.image_max_side), Image.Resampling.LANCZOS)
    thumb = im.copy()
    thumb.thumbnail((settings.thumb_max_side, settings.thumb_max_side), Image.Resampling.LANCZOS)

    def jpeg(img: Image.Image, q: int) -> bytes:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q, optimize=True)      # no exif= argument: metadata is not carried over
        return buf.getvalue()

    return Processed(jpeg(big, 85), jpeg(thumb, 80), taken, gps)


# ------------------------------------------------------------------ text safety
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_NAME_OK = re.compile(r"[^A-Za-z0-9 ._()-]")


def clean_caption(caption: Optional[str]) -> Optional[str]:
    c = _CTRL.sub(" ", caption or "").strip()
    return c[:200] or None


def caption_from_filename(name: Optional[str]) -> Optional[str]:
    """The client file name is never used as a path; at most a sanitised stem becomes a caption fallback."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    stem = _NAME_OK.sub("", base.rsplit(".", 1)[0]).strip()
    return stem[:80] or None


# ------------------------------------------------------------------ rate limit (in memory, per user)
_hits: dict[str, deque] = defaultdict(deque)


def rate_limited(user_id: str, now: Optional[float] = None) -> bool:
    """Record an attempt; True when the user has exceeded WAYMARK_UPLOAD_RATE_PER_MIN in the last 60 seconds."""
    now = time.monotonic() if now is None else now
    q = _hits[user_id]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.upload_rate_per_min:
        return True
    q.append(now)
    return False


def reset_rate_limits() -> None:
    _hits.clear()
