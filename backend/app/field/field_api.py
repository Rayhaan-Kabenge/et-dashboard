"""Field Health router, mounted at /api/field (only when FEATURE_FIELD_HEALTH).

Isolated: imports only from this package. Never imports et_engine / compute /
sheets / weather.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException

from . import field_store, indices
from .geometry import validate_polygon
from .schemas import Field, FieldCreate, IndexPoint, IndexSeries

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


@router.get("/{field_id}/indices", response_model=IndexSeries)
def get_indices(
    field_id: str,
    index: str = "NDRE",
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    """NDRE (default) / NDVI time series for the field. Cloudy/empty ranges return
    an empty series with a note — never a 500."""
    field = field_store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    today = date.today()
    end = end or today.isoformat()
    start = start or (today - timedelta(days=120)).isoformat()
    points, last_obs, note = indices.get_index_series(field, index, start, end)
    return IndexSeries(
        field_id=field_id, index=index.upper(), start=start, end=end,
        points=[IndexPoint(**p) for p in points], last_observation=last_obs, note=note)
