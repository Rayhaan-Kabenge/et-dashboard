"""Field Health router, mounted at /api/field (only when FEATURE_FIELD_HEALTH).

Isolated: imports only from this package. Never imports et_engine / compute /
sheets / weather.
"""
from __future__ import annotations

import base64
import time
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..config import get_settings
from . import field_store, gridmet, indices, openet, summary as summary_svc
from .geometry import validate_polygon
from .schemas import Field, FieldCreate, FieldImage, IndexPoint, IndexSeries, SummaryResponse
from .sentinel import SentinelClient, SentinelError

router = APIRouter(prefix="/api/field", tags=["field-health"])

IMAGE_TTL = 6 * 3600  # seconds — cache the "latest" image briefly


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


@router.get("/{field_id}/image", response_model=FieldImage)
def get_image(field_id: str, index: str = "NDRE", date: str = "latest"):
    """Colorized index PNG (base64) for the latest valid scene (or a given date),
    clipped to the field. Cloudy/missing -> note, never a 500."""
    field = field_store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    index = index.upper()
    resolved_date = None if date == "latest" else date

    cache_png = field_store.cache_path(field_id, f"image_{index}_{date}.png")
    fresh = (
        cache_png.exists()
        and cache_png.stat().st_size > 0
        and (date != "latest" or (time.time() - cache_png.stat().st_mtime) < IMAGE_TTL)
    )
    if fresh:
        b64 = base64.b64encode(cache_png.read_bytes()).decode()
        return FieldImage(field_id=field_id, index=index, date=resolved_date, png_base64=b64, bbox=field.bbox)

    s = get_settings()
    client = SentinelClient(s.sh_client_id, s.sh_client_secret)
    try:
        png = client.index_png(field.geometry, field.bbox, index, date)
        cache_png.write_bytes(png)
        b64 = base64.b64encode(png).decode()
        return FieldImage(field_id=field_id, index=index, date=resolved_date, png_base64=b64, bbox=field.bbox)
    except SentinelError as exc:
        return FieldImage(field_id=field_id, index=index, date=None, png_base64=None, bbox=field.bbox, note=str(exc))


def _require_field(field_id: str) -> Field:
    field = field_store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.post("/{field_id}/summary", response_model=SummaryResponse)
def field_summary(field_id: str):
    """v1 stub — returns a 'coming soon' placeholder. v2 assembles computed values
    and calls Anthropic."""
    return summary_svc.build_summary(_require_field(field_id))


# --- v2 scaffolds (typed empty results; NOT wired into the UI yet) -----------
@router.get("/{field_id}/et")
def actual_et(field_id: str, start: Optional[str] = None, end: Optional[str] = None):
    field = _require_field(field_id)
    return {"field_id": field_id, "source": "openet",
            "points": openet.actual_et(field, start or "", end or ""), "note": "v2 — not yet enabled"}


@router.get("/{field_id}/gridmet")
def reference_et(field_id: str, start: Optional[str] = None, end: Optional[str] = None):
    field = _require_field(field_id)
    return {"field_id": field_id, "source": "gridmet",
            "points": gridmet.reference_et(field, start or "", end or ""), "note": "v2 — not yet enabled"}
