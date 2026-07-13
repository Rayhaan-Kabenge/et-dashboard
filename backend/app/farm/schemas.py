"""Pydantic models for the engine-side Field→Zone model.

Kept separate from the frozen irrigation `app/schemas.py` and from the
satellite Field-Health `app/field/schemas.py` — this is the engine's
run-selection model (which sheet feeds which zone), nothing more.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field as PydField


class Zone(BaseModel):
    """A named MANAGEMENT UNIT within a Field — identity is name+boundary, NOT the
    crop. Carries its own crop + the Google Sheet that drives its engine run.
    Two zones may share a crop and still be distinct (different name/boundary).
    `boundary`/`area_acres` are OPTIONAL: a zone with no drawn polygon still runs
    its window (geometry is additive). `season_year` makes it multi-year-ready."""
    id: str
    name: str                                   # user label — "Corn block", "North half"
    crop: str                                   # "corn" | "sorghum" | ...
    # Drives this zone's engine run. MVP: derived from `crop` (corn→corn sheet,
    # sorghum→sorghum sheet), so same-crop zones share it and produce identical
    # windows — an accepted simplification. It is stored PER ZONE so a future
    # slice can give same-crop zones independent sources. See farm/api._sheet_for_crop.
    sheet_id: str
    season_year: Optional[int] = None
    boundary: Optional[dict[str, Any]] = None   # GeoJSON polygon drawn within the field
    area_acres: Optional[float] = None          # computed from the polygon


class Field(BaseModel):
    """One physical field / irrigation system: a whole-field `boundary` (the pivot
    outline) and >= 1 zone. A single-crop field is one zone (whole field); a split
    field has several. Satellite (NDRE/SI) is field-level on `boundary` for now."""
    id: str
    name: str
    boundary: Optional[dict[str, Any]] = None   # GeoJSON polygon — the field outline
    area_acres: Optional[float] = None          # computed from the polygon
    meter: Optional[dict[str, Any]] = None      # field-level flow meter (Slice 3)
    zones: list[Zone] = PydField(min_length=1)


class ZoneCreate(BaseModel):
    name: str
    crop: str
    sheet_id: str
    season_year: Optional[int] = None
    boundary: Optional[dict[str, Any]] = None
    area_acres: Optional[float] = None


class FieldCreate(BaseModel):
    name: str
    zones: list[ZoneCreate] = PydField(min_length=1)  # a field must have >= 1 zone
    boundary: Optional[dict[str, Any]] = None
    area_acres: Optional[float] = None
    meter: Optional[dict[str, Any]] = None


class FieldsResponse(BaseModel):
    active_field_id: Optional[str] = None
    fields: list[Field] = []


# --- drawing / geometry wiring (Slice 4a) ----------------------------------- #
class BoundaryUpdate(BaseModel):
    """Set/replace the field's whole-outline boundary (drawn or uploaded GeoJSON)."""
    geometry: dict[str, Any]


class ZoneDraw(BaseModel):
    """Create a management zone from the map: a user name + a crop (→ sheet_id via
    the registry) + an optional drawn polygon. sheet_id/area are resolved server-
    side; boundary is optional so a zone can exist before it's drawn."""
    name: str
    crop: str
    boundary: Optional[dict[str, Any]] = None
    sheet_id: Optional[str] = None              # override; else resolved from crop


class ZonePatch(BaseModel):
    """Partial update of a zone — rename, re-crop (re-resolves sheet_id), or
    (re)draw its boundary. Any omitted field is left unchanged."""
    name: Optional[str] = None
    crop: Optional[str] = None
    boundary: Optional[dict[str, Any]] = None


class MeterReading(BaseModel):
    """One cumulative (odometer-style) flow-meter reading for the whole field."""
    date: str                                   # ISO date the reading was taken
    meter_reading: float                        # cumulative meter value at that date
    unit: str = "gallons"                       # gallons | acre-inches | acre-feet | m3


class FieldMeter(BaseModel):
    """The field's ONE flow meter (field-level, across all zones). Optional — the
    recommendation works fully without it. First reading = season baseline."""
    readings: list[MeterReading] = []
    area_basis: str = "field"                   # "field" (field acreage) | "manual"
    area_override: Optional[float] = None       # acres, when area_basis == "manual"


class MeterPoint(BaseModel):
    date: str
    meter_reading: float
    unit: str
    increment_in: float                         # pumped depth added since previous reading
    cumulative_pumped_in: float
    cumulative_pumped_mm: float


class MeterResponse(BaseModel):
    """Cumulative pumped-depth series derived from the field meter log. Compared on
    the frontend against the summed per-zone recommended total. Engine untouched."""
    field_id: str
    readings: list[MeterReading] = []
    area_acres: float                           # acreage actually used in the conversion
    area_basis: str                             # "field" | "manual"
    area_override: Optional[float] = None
    points: list[MeterPoint] = []
    total_pumped_in: float = 0.0
    total_pumped_mm: float = 0.0
    note: Optional[str] = None


class RiskResponse(BaseModel):
    """Pre-computed Bayesian risk posteriors for a zone's crop (read-only assembly).

    `status="ok"` carries the three-zone (Below/Target/Above) skew-normal posteriors
    per metric; `status="unavailable"` carries only a message (the zone's crop is not
    covered by any posterior yet, or the data file is missing). Nothing is computed
    live — this just serves the JSON, gated by the zone's crop."""
    status: str                                        # "ok" | "unavailable"
    zone_id: str
    zone_crop: str
    zone_name: Optional[str] = None
    model_crop: Optional[str] = None                   # crop(s) the posterior is based on
    ratio_basis: Optional[str] = None                  # applied ÷ recommended (from the JSON)
    distribution: Optional[str] = None                 # e.g. "skew_normal"
    zone_bands: Optional[dict[str, Any]] = None        # Below/Target/Above ratio ranges
    zone_observations: Optional[dict[str, int]] = None # n per band (honest confidence)
    metric_display_order: Optional[list[str]] = None
    metrics: Optional[dict[str, Any]] = None           # per-metric per-band μ/σ/α + CIs
    caveats: list[str] = []
    source: Optional[str] = None
    message: Optional[str] = None
