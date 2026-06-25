"""Field Health router, mounted at /api/field (only when FEATURE_FIELD_HEALTH).

Isolated: imports only from this package. Never imports et_engine / compute /
sheets / weather.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from . import field_store
from .geometry import validate_polygon
from .schemas import Field, FieldCreate

router = APIRouter(prefix="/api/field", tags=["field-health"])


@router.get("/health")
def health():
    return {"status": "ok", "module": "field-health"}


@router.get("", response_model=Optional[Field])
def get_active_field():
    """The active field, or null if none has been defined yet."""
    return field_store.get_active()


@router.post("", response_model=Field, status_code=201)
def create_field(body: FieldCreate):
    """Create a field from a GeoJSON Polygon; computes centroid/bbox/area and
    makes it the active field."""
    err = validate_polygon(body.geometry)
    if err:
        raise HTTPException(status_code=422, detail=f"invalid field geometry: {err}")
    return field_store.create_field(body.name, body.geometry, body.crop)


@router.post("/{field_id}/activate", response_model=Field)
def activate_field(field_id: str):
    field = field_store.set_active(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field
