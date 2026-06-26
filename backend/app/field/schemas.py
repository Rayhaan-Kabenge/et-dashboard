"""Pydantic models for the Field Health module. Separate from the frozen
irrigation `app/schemas.py` (no coupling)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class Field(BaseModel):
    id: str
    name: str
    geometry: dict[str, Any]        # GeoJSON Polygon (WGS84)
    centroid: list[float]           # [lon, lat]
    bbox: list[float]               # [minLon, minLat, maxLon, maxLat]
    area_acres: float
    crop: Optional[str] = None
    created_at: str


class FieldCreate(BaseModel):
    name: str
    geometry: dict[str, Any]
    crop: Optional[str] = None


class IndexPoint(BaseModel):
    date: str
    mean: float
    stdev: float
    valid_fraction: float


class IndexSeries(BaseModel):
    field_id: str
    index: str                      # "NDRE" | "NDVI"
    start: str
    end: str
    points: list[IndexPoint] = []
    last_observation: Optional[str] = None
    note: Optional[str] = None      # e.g. "no cloud-free imagery" / config hint


class FieldImage(BaseModel):
    field_id: str
    index: str
    date: Optional[str] = None
    png_base64: Optional[str] = None
    bbox: Optional[list[float]] = None
    note: Optional[str] = None


class ETPoint(BaseModel):
    date: str
    mm: float


class ETResponse(BaseModel):
    et_actual: list[ETPoint] = []        # OpenET daily actual ET (mm)
    etr_gridmet: list[ETPoint] = []      # gridMET alfalfa reference ET (mm) via OpenET
    provisional_from: Optional[str] = None
    coverage: str = "ok"                 # "ok" | "out_of_area"
    note: Optional[str] = None


class SummaryResponse(BaseModel):
    status: str                     # "stub" in v1
    message: str
