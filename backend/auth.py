"""JWT auth, configured demo accounts, registered accounts and auth dependencies.

Demo accounts live in backend/config/demo_users.json; registered accounts use the SQLite accounts table.
Passwords are PBKDF2 hashes generated with stdlib hashlib.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sys
import time
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Callable

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .models_ops import Account

USERS_PATH = Path(__file__).resolve().parent / "config" / "demo_users.json"
PBKDF2_ITERATIONS = 200_000
ALGORITHM = "HS256"


class Role(str, Enum):
    planner = "planner"
    engineer = "engineer"
    community = "community"


ROLE_LABELS = {
    Role.planner: "City Planner",
    Role.engineer: "Road Authorities",
    Role.community: "Traffic Police",
}


@dataclass(frozen=True)
class User:
    id: str
    name: str
    role: Role


# ------------------------------------------------------------------ passwords
def hash_password(password: str, salt: bytes | None = None, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iters, salt_hex, digest_hex = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=1)
def _load_users() -> dict[str, dict]:
    try:
        rows = json.loads(USERS_PATH.read_text(encoding="utf-8"))["users"]
    except (OSError, ValueError, KeyError) as e:
        raise RuntimeError(f"{USERS_PATH.name}: cannot load the demo accounts ({e})") from None
    return {r["username"]: r for r in rows}


def authenticate(username: str, password: str, db: Session | None = None) -> User | None:
    normalized = username.strip().lower()
    row = _load_users().get(normalized)
    account = db.get(Account, normalized) if db is not None and row is None else None
    # Always run one hash so an unknown username takes about as long as a wrong password.
    stored = row["password_hash"] if row else (account.password_hash if account else hash_password("x", b"\0" * 16, 1000))
    ok = verify_password(password, stored)
    if not ok or (row is None and account is None):
        return None
    if row:
        return User(id=row["username"], name=row["name"], role=Role(row["role"]))
    return User(id=account.id, name=account.name, role=Role(account.role))


# ------------------------------------------------------------------ tokens
def create_token(user: User) -> str:
    now = int(time.time())
    claims = {"sub": user.id, "role": user.role.value, "name": user.name,
              "iat": now, "exp": now + settings.jwt_ttl_min * 60}
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> User:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub", "role"]})
        return User(id=str(claims["sub"]), name=str(claims.get("name") or claims["sub"]), role=Role(claims["role"]))
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "Your session is missing or has expired. Please sign in again.",
                            headers={"WWW-Authenticate": "Bearer"}) from None


# ------------------------------------------------------------------ dependencies
_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> User:
    if creds is None or not creds.credentials:
        raise HTTPException(401, "Sign in to use this feature.", headers={"WWW-Authenticate": "Bearer"})
    return decode_token(creds.credentials)


def require_role(*roles: Role) -> Callable[[User], User]:
    allowed = set(roles)

    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(403, "Your role is not allowed to do this.")
        return user

    return dep


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "hash":
        print(hash_password(sys.argv[2]))
    else:
        sys.exit("usage: python -m backend.auth hash <password>")
