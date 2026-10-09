"""Loads and validates backend/config/effects.json. A bad file stops the app with a clear message, never a guess."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CONFIG_DIR = Path(__file__).resolve().parent / "config"
EFFECTS_PATH = CONFIG_DIR / "effects.json"

ROLE_IDS = ("planner", "engineer", "community")
STATUSES = ("planned", "in_progress", "evidence_submitted", "verified")
EVIDENCE_KINDS = ("before", "during", "after")


class ConfigError(RuntimeError):
    """Raised when a configuration file is missing, malformed or incomplete."""


@dataclass(frozen=True)
class Category:
    id: str
    label: str
    weight: float
    default_owner: str
    evidence_required: tuple[str, ...]
    placeholder: bool


@dataclass(frozen=True)
class Effects:
    placeholder: bool
    credit_cap: float
    stage_factors: dict[str, float]
    categories: dict[str, Category]

    def weight_for(self, category: str) -> float:
        return self.categories[category].weight


def _fail(path: Path, key: str, problem: str) -> ConfigError:
    return ConfigError(f"{path.name}: '{key}' {problem}")


def _number(path: Path, key: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise _fail(path, key, f"must be a finite number, got {value!r}")
    return float(value)


def parse_effects(data: object, path: Path = EFFECTS_PATH) -> Effects:
    if not isinstance(data, dict):
        raise _fail(path, "<root>", "must be a JSON object")
    for key in ("credit_cap", "stage_factors", "categories"):
        if key not in data:
            raise _fail(path, key, "is missing")

    cap = _number(path, "credit_cap", data["credit_cap"])
    if not 0 < cap <= 1:
        raise _fail(path, "credit_cap", f"must be greater than 0 and at most 1, got {cap}")

    raw_stages = data["stage_factors"]
    if not isinstance(raw_stages, dict):
        raise _fail(path, "stage_factors", "must be an object")
    stages: dict[str, float] = {}
    for status in STATUSES:
        if status not in raw_stages:
            raise _fail(path, f"stage_factors.{status}", "is missing")
        stages[status] = _number(path, f"stage_factors.{status}", raw_stages[status])
        if not 0 <= stages[status] <= 1:
            raise _fail(path, f"stage_factors.{status}", f"must be between 0 and 1, got {stages[status]}")
    ordered = [stages[s] for s in STATUSES]
    if any(b < a for a, b in zip(ordered, ordered[1:])):
        raise _fail(path, "stage_factors", f"must not decrease from planned to verified, got {ordered}")
    if stages["verified"] != 1.0:
        raise _fail(path, "stage_factors.verified", f"must be exactly 1.0, got {stages['verified']}")

    raw_cats = data["categories"]
    if not isinstance(raw_cats, dict) or not raw_cats:
        raise _fail(path, "categories", "must be a non-empty object")
    cats: dict[str, Category] = {}
    for cid, c in raw_cats.items():
        where = f"categories.{cid}"
        if not isinstance(c, dict):
            raise _fail(path, where, "must be an object")
        for key in ("label", "weight", "default_owner", "evidence_required"):
            if key not in c:
                raise _fail(path, f"{where}.{key}", "is missing")
        weight = _number(path, f"{where}.weight", c["weight"])
        if not 0 <= weight <= 1:
            raise _fail(path, f"{where}.weight", f"must be between 0 and 1, got {weight}")
        if c["default_owner"] not in ROLE_IDS:
            raise _fail(path, f"{where}.default_owner", f"must be one of {list(ROLE_IDS)}, got {c['default_owner']!r}")
        req = c["evidence_required"]
        if not isinstance(req, list) or any(k not in EVIDENCE_KINDS for k in req):
            raise _fail(path, f"{where}.evidence_required", f"must be a list drawn from {list(EVIDENCE_KINDS)}")
        if not isinstance(c["label"], str) or not c["label"].strip():
            raise _fail(path, f"{where}.label", "must be a non-empty string")
        cats[cid] = Category(cid, c["label"], weight, c["default_owner"], tuple(req), bool(c.get("placeholder", False)))

    return Effects(bool(data.get("placeholder", False)), cap, stages, cats)


def load_effects(path: Path = EFFECTS_PATH) -> Effects:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise ConfigError(f"{path.name}: cannot read the file ({e.strerror or e})") from None
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ConfigError(f"{path.name}: not valid JSON ({e})") from None
    return parse_effects(data, path)


@lru_cache(maxsize=1)
def get_effects() -> Effects:
    return load_effects()


def placeholder_weights() -> bool:
    """True while any weight in effects.json is still a placeholder (the UI, PDF and README must say so)."""
    e = get_effects()
    return e.placeholder or any(c.placeholder for c in e.categories.values())
