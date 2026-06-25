"""Field Health router, mounted at /api/field (only when FEATURE_FIELD_HEALTH).

Isolated: imports only from this package. Never imports et_engine / compute /
sheets / weather.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from . import field_store
from .schemas import Field

router = APIRouter(prefix="/api/field", tags=["field-health"])


@router.get("/health")
def health():
    return {"status": "ok", "module": "field-health"}


@router.get("", response_model=Optional[Field])
def get_active_field():
    """The active field, or null if none has been defined yet."""
    return field_store.get_active()
