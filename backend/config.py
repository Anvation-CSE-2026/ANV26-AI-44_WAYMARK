"""Typed settings read from the environment. Every variable has a default, so the app starts with no .env file.

Tests change values by assigning to attributes of `settings` (monkeypatch.setattr), so read them at call time
rather than copying them into module constants.
"""
from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("waymark.config")
ROOT = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    """Read simple KEY=value entries without requiring an optional dotenv package."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    except OSError as exc:
        log.warning("Could not read %s: %s", path.name, exc)
        return

    for line in lines:
        entry = line.strip()
        if not entry or entry.startswith("#"):
            continue
        if entry.startswith("export "):
            entry = entry[7:].lstrip()
        name, separator, value = entry.partition("=")
        name = name.strip()
        if not separator or not name or not name.replace("_", "a").isalnum() or name[0].isdigit():
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        os.environ.setdefault(name, value)


_load_env_file(ROOT / ".env")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        raise SystemExit(f"Environment variable {name} must be a whole number, got {raw!r}.")


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        raise SystemExit(f"Environment variable {name} must be a number, got {raw!r}.")


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _jwt_secret() -> str:
    value = os.getenv("WAYMARK_JWT_SECRET", "").strip()
    if value:
        return value
    log.warning("WAYMARK_JWT_SECRET is not set: using a random secret for this process. "
                "Tokens stop working when the server restarts. Set the variable for a stable secret.")
    return secrets.token_urlsafe(48)


def _data_dir() -> Path:
    p = Path(os.getenv("WAYMARK_DATA_DIR", "data"))
    return p if p.is_absolute() else ROOT / p


def _origins() -> list[str]:
    # WAYMARK_CORS is the older name used before the operations build; keep honouring it.
    raw = os.getenv("WAYMARK_CORS_ORIGINS") or os.getenv("WAYMARK_CORS") or "http://localhost:5173,http://127.0.0.1:5173"
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass
class Settings:
    jwt_secret: str = field(default_factory=_jwt_secret)
    jwt_ttl_min: int = field(default_factory=lambda: _int("WAYMARK_JWT_TTL_MIN", 480))
    demo_mode: bool = field(default_factory=lambda: _flag("WAYMARK_DEMO_MODE", True))
    data_dir: Path = field(default_factory=_data_dir)
    cors_origins: list[str] = field(default_factory=_origins)
    max_upload_mb: int = field(default_factory=lambda: _int("WAYMARK_MAX_UPLOAD_MB", 10))
    upload_rate_per_min: int = field(default_factory=lambda: _int("WAYMARK_UPLOAD_RATE_PER_MIN", 10))
    max_report_cells: int = field(default_factory=lambda: _int("WAYMARK_MAX_REPORT_CELLS", 5000))
    geo_far_km: float = field(default_factory=lambda: _float("WAYMARK_GEO_FAR_KM", 1.0))
    stale_photo_days: int = field(default_factory=lambda: _int("WAYMARK_STALE_PHOTO_DAYS", 30))
    llm_provider: str = field(default_factory=lambda: os.getenv("WAYMARK_LLM_PROVIDER", "auto").strip().lower())
    groq_api_key: str | None = field(default_factory=lambda: os.getenv("GROQ_API_KEY") or None)
    groq_model: str = field(default_factory=lambda: os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"))
    anthropic_api_key: str | None = field(default_factory=lambda: os.getenv("ANTHROPIC_API_KEY") or None)
    anthropic_model: str = field(default_factory=lambda: os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    chat_max_tokens: int = field(default_factory=lambda: _int("WAYMARK_CHAT_MAX_TOKENS", 1500))

    # Fixed (not environment) limits used by the evidence pipeline.
    image_max_side: int = 2000
    thumb_max_side: int = 320


settings = Settings()
