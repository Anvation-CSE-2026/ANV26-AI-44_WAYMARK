"""The single permission table. Other modules only call `can()` / `require_permission()`; never re-state it."""
from __future__ import annotations

from typing import Callable

from fastapi import Depends, HTTPException

from .auth import Role, User, current_user

P, E, C = Role.planner, Role.engineer, Role.community

PERMISSIONS: dict[str, frozenset[Role]] = {
    "report.create": frozenset({P, E, C}),
    "report.read": frozenset({P, E, C}),
    "chat.use": frozenset({P, E, C}),
    "measure.create": frozenset({P, E, C}),          # community measures always start as `planned`
    "measure.transition": frozenset({P, E}),         # every non-verify status change
    "measure.comment": frozenset({P, E, C}),
    "evidence.upload": frozenset({P, E, C}),
    "evidence.read": frozenset({P, E, C}),
    "measure.verify": frozenset({P}),                # approve or reject
}


def can(role: Role, action: str) -> bool:
    return role in PERMISSIONS.get(action, frozenset())


def require_permission(action: str) -> Callable[[User], User]:
    if action not in PERMISSIONS:
        raise KeyError(f"unknown permission {action!r}")

    def dep(user: User = Depends(current_user)) -> User:
        if not can(user.role, action):
            raise HTTPException(403, detail={"code": "forbidden",
                                             "message": f"Your role ({user.role.value}) cannot do this ({action})."})
        return user

    return dep
