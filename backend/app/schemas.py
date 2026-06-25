"""Pydantic response models for the API. These describe the /api/state payload.

Everything here is DERIVED from the engine output (see compute.py). No science is
recomputed in these models; they are pure data-transfer shapes for the frontend.
All depths are in millimetres (the UI does mm<->inch display conversion itself).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


class Site(BaseModel):
    name: str
    season: int
    latitude: float
    longitude: Optional[float] = None
    elevation: float
    planting_date: date
    reference_crop: str          # "Tall" | "Short"
    units_default: str = "mm"    # display default; engine always metric
    sheet_edit_url: Optional[str] = None
    demo_mode: bool = False


class DayWeather(BaseModel):
    tmax: Optional[float] = None
    tmin: Optional[float] = None
    rhmax: Optional[float] = None
    rhmin: Optional[float] = None
    u2: Optional[float] = None
    rs: Optional[float] = None
    precip: Optional[float] = None


class Freshness(BaseModel):
    last_actual_date: Optional[date] = None
    days_since: Optional[int] = None
    stale: bool = False
    forecast_through: Optional[date] = None
    forecast_source: str = "none"  # "open-meteo" | "persistence" | "mixed" | "none"


class TodayState(BaseModel):
    date: date
    dap: int
    stage: str
    cumgdd: Optional[float] = None
    kcr: Optional[float] = None
    etr: Optional[float] = None
    etc: Optional[float] = None
    depletion: Optional[float] = None
    ad: Optional[float] = None
    should_irrigate: bool = False
    estimated: bool = False        # today sits in an open interval (provisional Kcr/ETc)
    weather: DayWeather


class Decision(BaseModel):
    should_irrigate_now: bool
    days_to_trigger: Optional[float] = None
    projected_trigger_date: Optional[date] = None
    recent_avg_etc: Optional[float] = None
    depletion: Optional[float] = None
    ad: Optional[float] = None
    headroom: Optional[float] = None      # ad - depletion (mm of buffer left)
    estimated: bool = False               # projection leans on provisional stage dates
    recommendation: str


class SeriesPoint(BaseModel):
    date: date
    dap: int
    stage: str
    depletion: Optional[float] = None
    ad: Optional[float] = None
    etc: Optional[float] = None
    etr: Optional[float] = None
    kcr: Optional[float] = None
    applied: float = 0.0
    precip: Optional[float] = None
    tmax: Optional[float] = None
    tmin: Optional[float] = None
    kind: str = "observed"         # "observed" | "provisional" | "forecast"
    is_forecast: bool = False


class GrowthStage(BaseModel):
    stage: str
    interval: int
    dap: int
    cumgdd: Optional[float] = None
    kcr: Optional[float] = None
    progress: float = 0.0          # 0..1 within current interval (clamped)
    season_progress: float = 0.0   # 0..1 across the whole stage list (for illustration)
    estimated: bool = False        # current interval bounded by a provisional next stage


class ScheduleEntry(BaseModel):
    date: date
    type: str                      # "Irrig" | "Fert"
    applied: float = 0.0           # ET-Model readback (engine output)
    triggered: bool = False
    is_forecast: bool = False


class SeasonSummary(BaseModel):
    total_etc: float = 0.0
    total_applied_irrig: float = 0.0
    total_applied_fert: float = 0.0
    total_rainfall: float = 0.0
    effective_rainfall: float = 0.0
    irrigation_events: int = 0
    fertigation_events: int = 0


class Alert(BaseModel):
    level: str                     # "info" | "warning" | "critical"
    code: str                      # "trigger_reached" | "stale_data" | "load_warning"
    message: str


class StateResponse(BaseModel):
    site: Site
    freshness: Freshness
    today: Optional[TodayState] = None
    decision: Optional[Decision] = None
    series: list[SeriesPoint] = []
    growth_stage: Optional[GrowthStage] = None
    season_summary: SeasonSummary = SeasonSummary()
    schedule: list[ScheduleEntry] = []
    alerts: list[Alert] = []
    generated_at: str


class FieldError(BaseModel):
    tab: str
    field: str
    message: str


class ValidateResponse(BaseModel):
    ok: bool
    errors: list[FieldError] = []
    warnings: list[str] = []
