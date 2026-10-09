"""Small helpers shared by the operations routes."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException


def iso(dt: Optional[datetime]) -> Optional[str]:
    """Naive-UTC datetime -> ISO-8601 string with a trailing Z (so browsers parse it as UTC)."""
    return None if dt is None else dt.replace(microsecond=0).isoformat() + "Z"


def iso_req(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"


def api_error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    """HTTPException whose detail is {code, message, ...}. The frontend shows `message` and branches on `code`."""
    return HTTPException(status, detail={"code": code, "message": message, **extra})
