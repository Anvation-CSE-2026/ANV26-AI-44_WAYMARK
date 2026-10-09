import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import ROLE_LABELS, Role, User, _load_users, authenticate, create_token, current_user, hash_password, verify_password
from ..config import settings
from ..db import get_db
from ..models_ops import Account
from ..schemas_ops import (ChangePasswordIn, DemoIn, LoginIn, PasswordChangedOut, ProfileUpdateIn, SignupIn,
                           TokenOut, UserOut)

router = APIRouter(prefix="/api", tags=["auth"])


def _token_out(user: User) -> TokenOut:
    return TokenOut(access_token=create_token(user), user=UserOut(id=user.id, name=user.name, role=user.role))


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(body.username, body.password, db)
    if user is None:
        raise HTTPException(401, "Wrong username or password.")
    return _token_out(user)


def _account_for_user(user: User, db: Session) -> Account:
    account = db.get(Account, user.id)
    if account is None:
        raise HTTPException(403, "Demo accounts do not have a persistent profile.")
    return account


@router.get("/auth/me", response_model=UserOut)
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = _account_for_user(user, db)
    return UserOut(id=account.id, name=account.name, role=Role(account.role))


@router.patch("/auth/profile", response_model=UserOut)
def update_profile(body: ProfileUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = _account_for_user(user, db)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name cannot be empty.")
    account.name = name
    db.commit()
    return UserOut(id=account.id, name=account.name, role=Role(account.role))


@router.post("/auth/change-password", response_model=PasswordChangedOut)
def change_password(body: ChangePasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    account = _account_for_user(user, db)
    if not verify_password(body.current_password, account.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(422, "Choose a new password different from your current password.")
    account.password_hash = hash_password(body.new_password)
    account.session_version = int(account.session_version or 0) + 1
    db.commit()
    return PasswordChangedOut(message="Password changed. Sign in again.")


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
