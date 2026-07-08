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


class GeocodeResult(BaseModel):
    display_name: str
    lat: float
    lon: float
    bbox: Optional[list[float]] = None  # [south, north, west, east]


class GeocodeResponse(BaseModel):
    results: list[GeocodeResult]


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


class EngineContext(BaseModel):
    """Engine-side numbers — supplied by the FRONTEND (from /api/state), never
    computed here."""
    stage: Optional[str] = None
    dap: Optional[int] = None
    depletion_mm: Optional[float] = None
    ad_mm: Optional[float] = None
    headroom_mm: Optional[float] = None
    decision: Optional[str] = None
    modeled_etc_cum_mm: Optional[float] = None


class SummaryRequest(BaseModel):
    range: dict[str, str] = {}          # {start, end}
    index: str = "NDRE"
    engine_context: EngineContext = EngineContext()


class SummaryResponse(BaseModel):
    status: str                          # "ok" | "unconfigured" | "error"
    summary_text: Optional[str] = None
    generated_at: Optional[str] = None
    model: Optional[str] = None
    inputs_fingerprint: Optional[str] = None
    message: Optional[str] = None


class ChatMessage(BaseModel):
    role: str                            # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = []
    range: dict[str, str] = {}           # {start, end}
    index: str = "NDRE"
    engine_context: EngineContext = EngineContext()


class ChatResponse(BaseModel):
    status: str                          # "ok" | "unconfigured" | "error"
    reply: Optional[str] = None
    generated_at: Optional[str] = None
    model: Optional[str] = None
    message: Optional[str] = None


class SiSummaryRequest(BaseModel):
    """Spatial SI summary request. Engine context arrives from the frontend
    (same rule as the field summary — never computed here)."""
    range: dict[str, str] = {}           # {start, end}
    threshold: float = 0.95
    engine_context: EngineContext = EngineContext()


class SufficiencyResponse(BaseModel):
    """Relative Sufficiency Index read (NDRE / 95th-percentile reference).
    status "unavailable" carries only a note (gated: stale scene / low canopy)."""
    status: str                          # "ok" | "unavailable"
    field_id: Optional[str] = None
    index: str = "NDRE"
    scene_date: Optional[str] = None
    reference_ndre: Optional[float] = None
    reference_method: Optional[str] = None
    canopy_median_ndre: Optional[float] = None
    valid_fraction: Optional[float] = None
    bare_soil_cutoff: Optional[float] = None   # NDRE floor; pixels below = bare/unplanted
    cropped_fraction: Optional[float] = None   # share of valid pixels SI covers
    bare_fraction: Optional[float] = None
    threshold: Optional[float] = None
    pct_below_threshold: Optional[float] = None  # over CROPPED pixels only
    histogram: Optional[list[int]] = None   # 0.01-wide SI bins over [0, 1.01)
    png_base64: Optional[str] = None
    bbox: Optional[list[float]] = None
    caveat: Optional[str] = None
    note: Optional[str] = None
