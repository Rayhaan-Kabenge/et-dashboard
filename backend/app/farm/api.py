"""Farm router — enumerate Fields and their Zones so a future UI can list them
and pick an active field. Engine-side (may read the crop registry); no science.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import get_settings, resolve_crop
from ..field.geometry import validate_polygon
from . import meter as meter_svc, risk as risk_svc, store
from .schemas import (
    BoundaryUpdate, Field, FieldMeter, FieldsResponse, MeterResponse, RiskResponse,
    ZoneDraw, ZonePatch)

router = APIRouter(prefix="/api", tags=["farm"])


@router.get("/fields", response_model=FieldsResponse)
def list_fields():
    """All fields with their zones, plus which field is active. Seeds the store
    (corn+sorghum zones of one field) on first access."""
    store.ensure_seeded(get_settings())
    return FieldsResponse(active_field_id=store.active_field_id(), fields=store.list_fields())


@router.get("/fields/{field_id}", response_model=Field)
def get_field(field_id: str):
    field = store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.post("/fields/{field_id}/activate", response_model=Field)
def activate_field(field_id: str):
    """Select a field as active (used when a run selection gives no explicit
    field_id — e.g. the `?crop=` alias resolves within the active field)."""
    field = store.set_active_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.put("/fields/{field_id}/boundary", response_model=Field)
def set_field_boundary(field_id: str, body: BoundaryUpdate):
    """Set/replace the field's whole-outline boundary (drawn or uploaded). Recomputes
    the field acreage. Satellite (NDRE/SI) stays field-level on this boundary."""
    err = validate_polygon(body.geometry)
    if err:
        raise HTTPException(status_code=422, detail=f"invalid field geometry: {err}")
    field = store.set_field_boundary(field_id, body.geometry)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


def _sheet_for_crop(crop: str) -> str:
    """MVP SHEET-ASSIGNMENT RULE (documented decision, not silent behavior):

    A zone's CROP determines its data source — "corn" → the corn sheet,
    "sorghum" → the sorghum sheet — via the config crop registry. Consequence:
    two zones that share a crop SHARE the sheet and therefore produce IDENTICAL
    windows. This is an accepted MVP simplification because our real field has
    exactly one corn zone + one sorghum zone, so crop uniquely identifies the
    source today.

    DEFERRED ENHANCEMENT — per-zone independent data sources: when two same-crop
    zones must differ (their own readings/schedules → different windows), stop
    deriving the sheet from the crop and give each zone its OWN sheet_id here.
    The seam already exists: the Zone model stores a per-zone `sheet_id` and
    ZoneDraw accepts an explicit `sheet_id` override — wire a zone-level sheet
    mapping through instead of this crop lookup. THIS is the place to extend.
    """
    return resolve_crop(crop, get_settings())


@router.post("/fields/{field_id}/zones", response_model=Field)
def add_zone(field_id: str, body: ZoneDraw):
    """Add a management zone drawn on the map: a user name + a crop (→ sheet_id) +
    an optional polygon. Two zones may share a crop — identity is name+boundary.
    Area is computed from the polygon."""
    if body.boundary is not None:
        err = validate_polygon(body.boundary)
        if err:
            raise HTTPException(status_code=422, detail=f"invalid zone geometry: {err}")
    # MVP: crop → sheet (see _sheet_for_crop). An explicit sheet_id override is the
    # forward-compatible seam for per-zone independent sources (deferred).
    sheet_id = body.sheet_id or _sheet_for_crop(body.crop)
    field = store.add_zone(field_id, name=body.name, crop=body.crop.strip().lower(),
                           sheet_id=sheet_id, boundary=body.boundary)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.put("/fields/{field_id}/zones/{zone_id}", response_model=Field)
def update_zone(field_id: str, zone_id: str, body: ZonePatch):
    """Rename, re-crop (re-resolves sheet_id per the MVP crop→sheet rule), or
    (re)draw a zone's boundary."""
    if body.boundary is not None:
        err = validate_polygon(body.boundary)
        if err:
            raise HTTPException(status_code=422, detail=f"invalid zone geometry: {err}")
    # MVP: re-cropping re-derives the sheet from the crop (see _sheet_for_crop).
    sheet_id = _sheet_for_crop(body.crop) if body.crop else None
    field = store.update_zone(field_id, zone_id, name=body.name,
                              crop=body.crop.strip().lower() if body.crop else None,
                              sheet_id=sheet_id, boundary=body.boundary)
    if field is None:
        raise HTTPException(status_code=404, detail="field or zone not found")
    return field


@router.delete("/fields/{field_id}/zones/{zone_id}", response_model=Field)
def delete_zone(field_id: str, zone_id: str):
    """Delete a zone. A Field always keeps >= 1 zone, so the last one can't go."""
    field, status = store.delete_zone(field_id, zone_id)
    if status == "not_found":
        raise HTTPException(status_code=404, detail="field or zone not found")
    if status == "last":
        raise HTTPException(status_code=409, detail="a field must keep at least one zone")
    return field


@router.get("/fields/{field_id}/meter", response_model=MeterResponse)
def get_meter(field_id: str):
    """The field's flow-meter log, converted to a cumulative pumped-depth series.
    Empty (no readings) until the grower logs some. Field-level + read-only —
    never affects the per-zone windows or zone selection."""
    field = store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    return meter_svc.compute(field, FieldMeter(**(store.get_meter(field_id) or {})))


@router.put("/fields/{field_id}/meter", response_model=MeterResponse)
def put_meter(field_id: str, body: FieldMeter):
    """Replace the field's meter log (readings + area basis/override). Stored on
    the Field object. Returns the recomputed cumulative pumped-depth series."""
    field = store.get_field(field_id)
    if field is None:
        raise HTTPException(status_code=404, detail="field not found")
    store.set_meter(field_id, body.model_dump())
    return meter_svc.compute(field, body)


@router.get("/risk", response_model=RiskResponse)
def get_risk(zone_id: str):
    """Pre-computed Bayesian risk posteriors for the zone's crop (read-only). Serves
    the three-zone skew-normal distributions when the crop is covered; otherwise a
    graceful 'analysis pending' state. Never applies one crop's model to another."""
    store.ensure_seeded(get_settings())
    zone = store.get_zone(zone_id)
    if zone is None:
        raise HTTPException(status_code=404, detail="zone not found")
    return risk_svc.risk_for_zone(zone)
