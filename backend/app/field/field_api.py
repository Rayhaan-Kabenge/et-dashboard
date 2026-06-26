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
from . import field_store, indices, openet, summary as summary_svc
from .geometry import validate_polygon
from .schemas import (
    ETPoint, ETResponse, Field, FieldCreate, FieldImage, IndexPoint, IndexSeries,
    SummaryRequest, SummaryResponse)
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


@router.delete("")
def clear_active_field():
    """Clear whatever field is currently active (store + its cache)."""
    active = field_store.get_active()
    if active is not None:
        field_store.delete_field(active.id)
    return {"cleared": True}


@router.delete("/{field_id}")
def clear_field(field_id: str):
    """Remove a field from the store, clear the active pointer if it pointed here,
    and delete its cached index/image/et/summary entries."""
    field_store.delete_field(field_id)
    return {"cleared": True}


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
def get_image(
    field_id: str,
    index: str = "NDRE",
    date: str = "latest",
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    """Colorized index PNG (base64), clipped to the field.

    With a [start, end] range: the most recent CLOUD-FREE scene inside it (date
    labelled). Otherwise the overall most-recent scene ("latest"). Cloudy/missing
    -> note, never a 500."""
    field = field_store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    index = index.upper()

    # Resolve the scene date: within a range, reuse the index series (same cloud
    # masking the timeline uses) to find the most recent valid observation.
    if start and end:
        _, last_obs, note = indices.get_index_series(field, index, start, end)
        if not last_obs:
            return FieldImage(field_id=field_id, index=index, date=None, png_base64=None,
                              bbox=field.bbox, note=note or "No cloud-free imagery in this range.")
        scene_date: Optional[str] = last_obs
        image_param = last_obs
        cache_tag = last_obs
    else:
        scene_date = None
        image_param = "latest"
        cache_tag = "latest"

    cache_png = field_store.cache_path(field_id, f"image_{index}_{cache_tag}.png")
    fresh = (
        cache_png.exists()
        and cache_png.stat().st_size > 0
        and (scene_date is not None or (time.time() - cache_png.stat().st_mtime) < IMAGE_TTL)
    )
    if fresh:
        b64 = base64.b64encode(cache_png.read_bytes()).decode()
        return FieldImage(field_id=field_id, index=index, date=scene_date, png_base64=b64, bbox=field.bbox)

    s = get_settings()
    client = SentinelClient(s.sh_client_id, s.sh_client_secret)
    try:
        png = client.index_png(field.geometry, field.bbox, index, image_param)
        cache_png.write_bytes(png)
        b64 = base64.b64encode(png).decode()
        return FieldImage(field_id=field_id, index=index, date=scene_date, png_base64=b64, bbox=field.bbox)
    except SentinelError as exc:
        return FieldImage(field_id=field_id, index=index, date=None, png_base64=None, bbox=field.bbox, note=str(exc))


def _require_field(field_id: str) -> Field:
    field = field_store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.post("/{field_id}/summary", response_model=SummaryResponse)
def field_summary(field_id: str, body: SummaryRequest = SummaryRequest(), force: bool = False):
    """Claude-written plain-language summary of the supplied engine numbers + this
    field's cached index/ET. Cached by input fingerprint; ?force=1 regenerates.
    No key / failure -> graceful note (never a 500)."""
    return summary_svc.build_summary(_require_field(field_id), body, force=force)


@router.get("/{field_id}/et", response_model=ETResponse)
def field_et(field_id: str, start: Optional[str] = None, end: Optional[str] = None):
    """OpenET actual ET + gridMET reference ET for the field/range. The modeled
    cumulative ETc and station ETr it's compared against arrive from the frontend,
    not here. Missing key / out-of-coverage / failure -> empty + note (never 500)."""
    field = _require_field(field_id)
    today = date.today()
    end = end or today.isoformat()
    start = start or (today - timedelta(days=120)).isoformat()
    data = openet.get_et(field, start, end)
    return ETResponse(
        et_actual=[ETPoint(**p) for p in data["et_actual"]],
        etr_gridmet=[ETPoint(**p) for p in data["etr_gridmet"]],
        provisional_from=data["provisional_from"], coverage=data["coverage"], note=data.get("note"))
