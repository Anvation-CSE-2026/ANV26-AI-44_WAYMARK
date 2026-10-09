"""Private report/evidence object storage with a local-filesystem development backend."""
from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import quote

import httpx

from .config import settings


class StorageError(RuntimeError):
    """A storage operation failed; the message is safe for application logs."""


def remote_storage_enabled() -> bool:
    configured = bool(settings.supabase_url and settings.supabase_service_role_key)
    partial = bool(settings.supabase_url) != bool(settings.supabase_service_role_key)
    if partial:
        raise RuntimeError("Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither.")
    return configured


def validate_storage_configuration() -> None:
    if settings.database_url and not remote_storage_enabled():
        raise RuntimeError("DATABASE_URL requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for persistent files.")
    remote_storage_enabled()


def _key_path(key: str) -> PurePosixPath:
    path = PurePosixPath(key)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError("Invalid storage object key.")
    return path


def local_path(key: str) -> Path:
    relative = _key_path(key)
    root = settings.data_dir.resolve()
    path = (root / Path(*relative.parts)).resolve()
    if root not in path.parents:
        raise ValueError("Invalid storage object key.")
    return path


def _remote_url(path: str) -> str:
    base = (settings.supabase_url or "").rstrip("/")
    return f"{base}/storage/v1/{path}"


def _headers(content_type: str | None = None) -> dict[str, str]:
    key = settings.supabase_service_role_key or ""
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _check(response: httpx.Response) -> None:
    if response.status_code >= 400:
        raise StorageError(f"Supabase Storage returned HTTP {response.status_code}.")


def ensure_private_bucket() -> None:
    """Create the app bucket if needed, and refuse to use a public bucket."""
    if not remote_storage_enabled():
        raise RuntimeError("Supabase Storage credentials are not configured.")
    bucket = settings.supabase_storage_bucket
    with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        response = client.post(
            _remote_url("bucket"),
            headers=_headers("application/json"),
            json={"id": bucket, "name": bucket, "public": False, "file_size_limit": 50 * 1024 * 1024,
                  "allowed_mime_types": ["image/jpeg", "application/pdf"]},
        )
        if response.status_code not in (200, 201, 409):
            _check(response)
        if response.status_code == 409:
            existing = client.get(_remote_url(f"bucket/{quote(bucket, safe='')}"), headers=_headers())
            _check(existing)
            try:
                is_public = bool(existing.json().get("public"))
            except (ValueError, AttributeError):
                raise StorageError("Could not verify Supabase bucket privacy.") from None
            if is_public:
                raise StorageError("The waymark-files bucket must be private.")


def put_object(key: str, data: bytes, content_type: str) -> None:
    path = _key_path(key)
    if remote_storage_enabled():
        bucket = quote(settings.supabase_storage_bucket, safe="")
        object_key = quote(path.as_posix(), safe="/")
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = client.post(
                _remote_url(f"object/{bucket}/{object_key}"),
                headers={**_headers(content_type), "x-upsert": "true", "cache-control": "3600"},
                content=data,
            )
            _check(response)
        return
    target = local_path(path.as_posix())
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def get_object(key: str) -> bytes:
    path = _key_path(key)
    if remote_storage_enabled():
        bucket = quote(settings.supabase_storage_bucket, safe="")
        object_key = quote(path.as_posix(), safe="/")
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = client.get(_remote_url(f"object/{bucket}/{object_key}"), headers=_headers())
        if response.status_code == 404:
            raise FileNotFoundError(path.as_posix())
        _check(response)
        return response.content
    target = local_path(path.as_posix())
    try:
        return target.read_bytes()
    except FileNotFoundError:
        raise FileNotFoundError(path.as_posix()) from None


def delete_object(key: str) -> None:
    path = _key_path(key)
    if remote_storage_enabled():
        bucket = quote(settings.supabase_storage_bucket, safe="")
        with httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            response = client.post(
                _remote_url(f"object/remove/{bucket}"), headers={**_headers("application/json")},
                json={"prefixes": [path.as_posix()]},
            )
        if response.status_code not in (200, 404):
            _check(response)
        return
    local_path(path.as_posix()).unlink(missing_ok=True)
