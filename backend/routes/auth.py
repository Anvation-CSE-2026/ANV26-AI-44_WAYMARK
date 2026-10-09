import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import ROLE_LABELS, Role, User, _load_users, authenticate, create_token, hash_password
from ..config import settings
from ..db import get_db
from ..models_ops import Account
from ..schemas_ops import DemoIn, LoginIn, SignupIn, TokenOut, UserOut

router = APIRouter(prefix="/api", tags=["auth"])


def _token_out(user: User) -> TokenOut:
    return TokenOut(access_token=create_token(user), user=UserOut(id=user.id, name=user.name, role=user.role))


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(body.username, body.password, db)
    if user is None:
        raise HTTPException(401, "Wrong username or password.")
    return _token_out(user)


@router.post("/auth/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "Enter a valid email address.")
    if not body.name.strip():
        raise HTTPException(422, "Enter your name.")
    if email in _load_users():
        raise HTTPException(409, "An account with this email already exists.")
    account = Account(id=email, name=body.name.strip(), password_hash=hash_password(body.password), role=body.role.value)
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists.") from None
    return _token_out(User(id=account.id, name=account.name, role=body.role))


@router.post("/auth/demo", response_model=TokenOut)
def demo(body: DemoIn):
    """Demo-mode sign-in: a token for the chosen role. Switched off with WAYMARK_DEMO_MODE=0."""
    if not settings.demo_mode:
        raise HTTPException(404, "Demo sign-in is turned off on this server.")
    role: Role = body.role
    return _token_out(User(id=f"demo-{role.value}", name=f"Demo {ROLE_LABELS[role]}", role=role))
