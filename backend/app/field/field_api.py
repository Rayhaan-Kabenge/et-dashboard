"""Field Health router, mounted at /api/field (only when FEATURE_FIELD_HEALTH).

Isolated from the ENGINE: never imports et_engine / compute / sheets / weather.
It DOES read the farm Field→Zone store (data only, not the engine) so satellite
analysis can run over a drawn ZONE's boundary — the same active zone that drives
the irrigation window (zone-level satellite). Only the boundary changes; the
Sentinel-2 fetch + NDRE/NDVI/SI math are unchanged.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Response

from ..config import get_settings
from ..farm import store as farm_store
from . import chat as chat_svc, field_store, geocode, indices, openet, sufficiency, summary as summary_svc
from .geometry import area_acres as geom_area, bbox as geom_bbox, centroid as geom_centroid, validate_polygon
from .schemas import (
    ChatRequest, ChatResponse, ETPoint, ETResponse, Field, FieldCreate, FieldImage,
    GeocodeResponse, IndexPoint, IndexSeries, SiSummaryRequest, SufficiencyResponse,
    SummaryRequest, SummaryResponse)
from .sentinel import SentinelClient, SentinelError

router = APIRouter(prefix="/api/field", tags=["field-health"])

IMAGE_TTL = 6 * 3600  # seconds — cache the "latest" image briefly


# --------------------------------------------------------------------------- #
# zone-level satellite: run the SAME analysis over a drawn ZONE's boundary
# --------------------------------------------------------------------------- #
def _zone_target(zone_id: str) -> tuple[Optional[Field], Optional[str]]:
    """Build a satellite target (a Field-shaped object) over a ZONE's boundary.

    Cache id is namespaced per zone AND per boundary geometry
    (`zone-<zone_id>-<geomhash>`) so zones never share cached grids and a redrawn
    boundary busts its own cache (no cross-zone poisoning). Falls back to the
    parent field's boundary when the zone has no drawn geometry yet. Returns
    (None, note) when there is no geometry at all. Raises 404 for a missing zone.
    """
    zone = farm_store.get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="zone not found")
    boundary = zone.boundary
    note: Optional[str] = None
    if not boundary:
        parent = farm_store.get_field_of_zone(zone_id)
        boundary = parent.boundary if parent else None
        note = ("Analyzed over the whole field — draw this zone's boundary for "
                "zone-level satellite analysis.")
    if not boundary:
        return None, "Draw this zone's boundary to run zone-level satellite analysis."

    geomhash = hashlib.sha1(json.dumps(boundary, sort_keys=True).encode()).hexdigest()[:8]
    field = Field(
        id=f"zone-{zone_id}-{geomhash}",
        name=zone.name,
        geometry=boundary,
        centroid=[round(c, 6) for c in geom_centroid(boundary)],
        bbox=[round(b, 6) for b in geom_bbox(boundary)],
        area_acres=round(zone.area_acres if zone.area_acres else geom_area(boundary), 2),
        crop=zone.crop,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    return field, note


def _image_over(field: Field, index: str, start: Optional[str], end: Optional[str]) -> FieldImage:
    """Colorized index PNG over a field/zone boundary (shared by the field- and
    zone-scoped image endpoints). Cache-keyed by the target's id."""
    index = index.upper()
    if start and end:
        _, last_obs, note = indices.get_index_series(field, index, start, end)
        if not last_obs:
            return FieldImage(field_id=field.id, index=index, date=None, png_base64=None,
                              bbox=field.bbox, note=note or "No cloud-free imagery in this range.")
        scene_date: Optional[str] = last_obs
        image_param = last_obs
        cache_tag = last_obs
    else:
        scene_date = None
        image_param = "latest"
        cache_tag = "latest"

    cache_png = field_store.cache_path(field.id, f"image_{index}_{cache_tag}.png")
    fresh = (
        cache_png.exists()
        and cache_png.stat().st_size > 0
        and (scene_date is not None or (time.time() - cache_png.stat().st_mtime) < IMAGE_TTL)
    )
    if fresh:
        b64 = base64.b64encode(cache_png.read_bytes()).decode()
        return FieldImage(field_id=field.id, index=index, date=scene_date, png_base64=b64, bbox=field.bbox)

    s = get_settings()
    client = SentinelClient(s.sh_client_id, s.sh_client_secret)
    try:
        png = client.index_png(field.geometry, field.bbox, index, image_param)
        cache_png.write_bytes(png)
        b64 = base64.b64encode(png).decode()
        return FieldImage(field_id=field.id, index=index, date=scene_date, png_base64=b64, bbox=field.bbox)
    except SentinelError as exc:
        return FieldImage(field_id=field.id, index=index, date=None, png_base64=None, bbox=field.bbox, note=str(exc))


@router.get("/health")
def health():
    return {"status": "ok", "module": "field-health"}


@router.get("/geocode", response_model=GeocodeResponse)
def geocode_search(q: str = ""):
    """View-only map navigation: proxy free-text/place lookups to OSM Nominatim.

    Pans/zooms the map only — it never sets, creates, or modifies the active
    field or any engine coordinate. Failures / no matches return {results: []}.
    """
    return {"results": geocode.search(q)}


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
    return _image_over(field, index, start, end)


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


@router.post("/{field_id}/chat", response_model=ChatResponse)
def field_chat(field_id: str, body: ChatRequest):
    """Interactive Q&A about this field, grounded on the SAME numeric block as the
    summary (grounding.numeric_block) — index trend, OpenET ET gap, and the engine
    context from the frontend. Advisory-only; never overrides the engine decision.
    No key / failure -> graceful note (never a 500)."""
    return chat_svc.build_chat(_require_field(field_id), body)


def _si_range(start: Optional[str], end: Optional[str]) -> tuple[str, str]:
    today = date.today()
    return (start or (today - timedelta(days=120)).isoformat(), end or today.isoformat())


@router.get("/{field_id}/sufficiency", response_model=SufficiencyResponse)
def field_sufficiency(field_id: str, start: Optional[str] = None, end: Optional[str] = None,
                      threshold: float = sufficiency.DEFAULT_THRESHOLD):
    """Relative Sufficiency Index heat map for the latest cloud-free scene in range
    (same scene the Latest-image panel shows). Reference = 95th-percentile in-field
    NDRE; SI = NDRE/reference capped at 1. Gated (stale scene / sparse canopy /
    too few valid pixels) -> status "unavailable" with a note, never a 500.
    NOT a nitrogen prescription — within-field variability only."""
    field = _require_field(field_id)
    s, e = _si_range(start, end)
    try:
        return sufficiency.compute(field, s, e, threshold=threshold)
    except sufficiency.SufficiencyUnavailable as exc:
        return SufficiencyResponse(status="unavailable", field_id=field_id, note=exc.reason,
                                   caveat=sufficiency.CAVEAT)
    except SentinelError as exc:
        return SufficiencyResponse(status="unavailable", field_id=field_id, note=str(exc),
                                   caveat=sufficiency.CAVEAT)


@router.post("/{field_id}/sufficiency/summary", response_model=SummaryResponse)
def field_sufficiency_summary(field_id: str, body: SiSummaryRequest = SiSummaryRequest(),
                              force: bool = False):
    """Claude-written spatial read of the masked SI stats (cropped pixels only),
    grounded on the shared numeric block + sufficiency.spatial_stats. Advisory,
    investigate-not-prescribe. Cached by fingerprint; ?force=1 regenerates.
    No SI / no key / failure -> graceful note (never a 500)."""
    return summary_svc.build_si_summary(_require_field(field_id), body, force=force)


# --------------------------------------------------------------------------- #
# zone-scoped satellite — same analysis, run over the active zone's boundary.
# Cache is per zone (+ boundary), so zones never share grids and drilling between
# zones doesn't recompute. SI reference + bare-soil mask are per-zone because the
# 95th-pct reference is taken over the fetched (zone) grid — math unchanged.
# --------------------------------------------------------------------------- #
@router.get("/zone/{zone_id}/indices", response_model=IndexSeries)
def zone_indices(zone_id: str, index: str = "NDRE",
                 start: Optional[str] = None, end: Optional[str] = None):
    """NDRE/NDVI time series over the ZONE's boundary (falls back to the field
    boundary + a note if the zone isn't drawn yet)."""
    today = date.today()
    end = end or today.isoformat()
    start = start or (today - timedelta(days=120)).isoformat()
    field, note = _zone_target(zone_id)
    if field is None:
        return IndexSeries(field_id=zone_id, index=index.upper(), start=start, end=end, note=note)
    points, last_obs, s_note = indices.get_index_series(field, index, start, end)
    return IndexSeries(field_id=zone_id, index=index.upper(), start=start, end=end,
                       points=[IndexPoint(**p) for p in points], last_observation=last_obs,
                       note=note or s_note)


@router.get("/zone/{zone_id}/image", response_model=FieldImage)
def zone_image(zone_id: str, index: str = "NDRE",
               start: Optional[str] = None, end: Optional[str] = None):
    """Colorized index PNG over the ZONE's boundary."""
    field, note = _zone_target(zone_id)
    if field is None:
        return FieldImage(field_id=zone_id, index=index.upper(), date=None, png_base64=None, note=note)
    img = _image_over(field, index, start, end)
    if note and not img.note:
        img.note = note
    return img


@router.get("/zone/{zone_id}/sufficiency", response_model=SufficiencyResponse)
def zone_sufficiency(zone_id: str, start: Optional[str] = None, end: Optional[str] = None,
                     threshold: float = sufficiency.DEFAULT_THRESHOLD):
    """SI heat map over the ZONE's boundary. The 95th-pct reference and bare-soil
    mask are computed over THIS ZONE's pixels only — the correctness requirement:
    a zone is compared to its own reference, never the whole field's."""
    field, note = _zone_target(zone_id)
    s, e = _si_range(start, end)
    if field is None:
        return SufficiencyResponse(status="unavailable", field_id=zone_id, note=note,
                                   caveat=sufficiency.CAVEAT)
    try:
        resp = sufficiency.compute(field, s, e, threshold=threshold)
        resp["field_id"] = zone_id
        if note:
            resp["note"] = note
        return resp
    except sufficiency.SufficiencyUnavailable as exc:
        return SufficiencyResponse(status="unavailable", field_id=zone_id, note=note or exc.reason,
                                   caveat=sufficiency.CAVEAT)
    except SentinelError as exc:
        return SufficiencyResponse(status="unavailable", field_id=zone_id, note=str(exc),
                                   caveat=sufficiency.CAVEAT)


@router.post("/zone/{zone_id}/sufficiency/summary", response_model=SummaryResponse)
def zone_sufficiency_summary(zone_id: str, body: SiSummaryRequest = SiSummaryRequest(),
                             force: bool = False):
    """Spatial AI read of the ZONE's masked SI stats (grounded on the zone's own
    SI + cached indices). Cached per zone."""
    field, note = _zone_target(zone_id)
    if field is None:
        return SummaryResponse(status="unavailable", message=note)
    return summary_svc.build_si_summary(field, body, force=force)


@router.get("/zone/{zone_id}/sufficiency/export")
def zone_sufficiency_export(zone_id: str, format: str = "geojson",
                            start: Optional[str] = None, end: Optional[str] = None,
                            threshold: float = sufficiency.DEFAULT_THRESHOLD):
    """Download the ZONE's SI surface as classified management-zone polygons."""
    field, _note = _zone_target(zone_id)
    if field is None:
        raise HTTPException(status_code=409, detail="draw this zone's boundary first")
    s, e = _si_range(start, end)
    try:
        if format.lower() in ("shp", "shapefile", "zip"):
            data, fname = sufficiency.export_shapefile_zip(field, s, e, threshold)
            media = "application/zip"
        else:
            data, fname = sufficiency.export_geojson(field, s, e, threshold)
            media = "application/geo+json"
    except sufficiency.SufficiencyUnavailable as exc:
        raise HTTPException(status_code=409, detail=exc.reason)
    except SentinelError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.get("/{field_id}/sufficiency/export")
def field_sufficiency_export(field_id: str, format: str = "geojson",
                             start: Optional[str] = None, end: Optional[str] = None,
                             threshold: float = sufficiency.DEFAULT_THRESHOLD):
    """Download the SI surface classified into 5 management zones (polygons with
    SI_value / SI_class / ndre_mean / below_threshold). format=geojson -> single
    WGS84 GeoJSON with metadata+caveat; format=shp -> zipped Shapefile bundle
    (.shp/.shx/.dbf/.prj) with a caveat README.txt."""
    field = _require_field(field_id)
    s, e = _si_range(start, end)
    try:
        if format.lower() in ("shp", "shapefile", "zip"):
            data, fname = sufficiency.export_shapefile_zip(field, s, e, threshold)
            media = "application/zip"
        else:
            data, fname = sufficiency.export_geojson(field, s, e, threshold)
            media = "application/geo+json"
    except sufficiency.SufficiencyUnavailable as exc:
        raise HTTPException(status_code=409, detail=exc.reason)
    except SentinelError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


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
