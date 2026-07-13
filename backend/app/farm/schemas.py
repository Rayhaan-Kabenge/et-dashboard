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
