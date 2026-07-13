"""Farm router — enumerate Fields and their Zones so a future UI can list them
and pick an active field. Engine-side (may read the crop registry); no science.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..config import get_settings
from . import meter as meter_svc, risk as risk_svc, store
from .schemas import Field, FieldMeter, FieldsResponse, MeterResponse, RiskResponse

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
