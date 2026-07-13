"""Pydantic models for the engine-side Field→Zone model.

Kept separate from the frozen irrigation `app/schemas.py` and from the
satellite Field-Health `app/field/schemas.py` — this is the engine's
run-selection model (which sheet feeds which zone), nothing more.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field as PydField


class Zone(BaseModel):
    """One crop zone within a Field. Carries its own crop + the Google Sheet that
    drives THIS zone's engine run. Boundaries/area are optional in this slice
    (drawn later); `season_year` makes the model multi-year-ready."""
    id: str
    name: str
    crop: str                                   # "corn" | "sorghum" | ...
    sheet_id: str                               # drives this zone's engine run
    season_year: Optional[int] = None
    boundary: Optional[dict[str, Any]] = None   # GeoJSON (optional this slice)
    area_acres: Optional[float] = None


class Field(BaseModel):
    """One physical field / irrigation system. ALWAYS has >= 1 zone: a single-crop
    field is exactly one zone (whole field), a split field has several."""
    id: str
    name: str
    boundary: Optional[dict[str, Any]] = None   # GeoJSON (optional this slice)
    area_acres: Optional[float] = None
    meter: Optional[dict[str, Any]] = None      # on the model, unused this slice
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
