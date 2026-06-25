"""Orchestration: load the sheet, fabricate the forecast, place provisional stage
dates for the open interval, run the engine, and derive the dashboard payload.

The ONLY science calls here are:
  * et_engine.run(...)             — the validated daily water balance.
  * et_engine.refet.etr_daily(...) — pyfao ASCE-2005 reference ET (the engine's
    own wrapper), used to route the sheet's humidity (RHmax/RHmin) into ETr and
    feed it through the engine's validated `etr_override` path.

Nothing here recomputes GDD, Kcr, ETc, runoff, depletion, or the trigger. The
provisional-stage placement is pure input-prep: it gives the engine a defined ΔG
for the current open interval so today's Kcr/ETc exist in-season (see the spec's
"Live open-interval estimation"). The engine is unchanged.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import mean
from typing import Optional

from et_engine import run
from et_engine.refet import etr_daily

from . import schemas
from .config import Settings
from .sheets import EngineInputs, make_source
from .weather import ForecastResult, fabricate_forecast


# --------------------------------------------------------------------------- #
# ETr (pyfao) over actuals + forecast, routed by the configured humidity input
# --------------------------------------------------------------------------- #
def _compute_etr(inputs: EngineInputs, weather: list[dict]) -> list[float]:
    cfg = inputs.config
    hum = (inputs.site.humidity_input or "RHmax_RHmin").lower()
    etr: list[float] = []
    for w in weather:
        kwargs = {}
        if "dew" in hum and w.get("tdew") is not None:
            kwargs["tdew"] = w["tdew"]
        elif "vapor" in hum and w.get("ea") is not None:
            kwargs["vapr"] = w["ea"]
        else:  # default & template: RHmax + RHmin
            if w.get("rhmax") is not None:
                kwargs["rhmax"] = w["rhmax"]
            if w.get("rhmin") is not None:
                kwargs["rhmin"] = w["rhmin"]
        etr.append(etr_daily(
            w["doy"], w["tmax"], w["tmin"], w["rs"], cfg.elev, cfg.lat,
            w["u"], cfg.wndht, cfg.tall, **kwargs))
    return etr


# --------------------------------------------------------------------------- #
# Live open-interval estimation: place provisional dates for undated stages
# --------------------------------------------------------------------------- #
def build_engine_stages(inputs: EngineInputs, last_actual_date: date, horizon_days: int):
    """Return (engine_stages, current_stage_date, provisional_dates).

    Observed (dated) stages pass through unchanged. Undated future stages get a
    provisional date = previous date + that previous stage's `Avg days to next`,
    walked cumulatively from the latest observed stage, and are included only while
    the provisional date is within (last_actual + horizon)."""
    observed = sorted([sr for sr in inputs.stage_rows if sr.date is not None], key=lambda s: s.date)
    future = [sr for sr in inputs.stage_rows if sr.date is None]  # sheet (phenological) order
    engine_stages = [sr.to_stage() for sr in observed]
    provisional: dict[str, date] = {}
    if not observed:
        return engine_stages, None, provisional

    current_date = observed[-1].date
    horizon_date = last_actual_date + timedelta(days=horizon_days)
    prev_date = current_date
    prev_avg = observed[-1].avg_days_to_next
    for fr in future:
        if prev_avg is None or prev_avg <= 0:
            break
        prov = prev_date + timedelta(days=int(round(prev_avg)))
        if prov > horizon_date:
            break
        engine_stages.append(fr.to_stage(prov))
        provisional[fr.label] = prov
        prev_date, prev_avg = prov, fr.avg_days_to_next

    engine_stages.sort(key=lambda s: s.date)
    return engine_stages, current_date, provisional


class ComputedRun:
    """Raw engine run plus the context needed to derive the payload/tests."""

    def __init__(self, inputs, weather, rows, n_actual, forecast,
                 engine_stages, current_stage_date, provisional):
        self.inputs = inputs
        self.weather = weather
        self.rows = rows
        self.n_actual = n_actual
        self.forecast = forecast
        self.engine_stages = engine_stages
        self.current_stage_date = current_stage_date   # D_cur (latest observed)
        self.provisional = provisional                 # label -> provisional date

    @property
    def actual_rows(self):
        return self.rows[: self.n_actual]

    @property
    def forecast_rows(self):
        return self.rows[self.n_actual:]

    def kind_for(self, row_index: int, d: date) -> str:
        if row_index >= self.n_actual:
            return "forecast"
        if (self.provisional and self.current_stage_date is not None
                and d >= self.current_stage_date):
            return "provisional"   # actual day in the open (estimated) interval
        return "observed"


def run_engine(inputs: EngineInputs, settings: Settings) -> ComputedRun:
    """Fabricate the forecast, place provisional stages, run the engine."""
    last_actual = inputs.weather[-1]["date"]
    forecast = fabricate_forecast(
        inputs.weather, lat=inputs.site.latitude, lon=inputs.site.longitude,
        season_year=inputs.site.season, n_days=settings.forecast_horizon_days,
        url=settings.open_meteo_url, timeout=settings.open_meteo_timeout)
    weather = list(inputs.weather) + list(forecast.days)

    engine_stages, cur_date, provisional = build_engine_stages(
        inputs, last_actual, settings.forecast_horizon_days)

    etr = _compute_etr(inputs, weather)
    rows = run(inputs.config, inputs.soil_layers, engine_stages,
               inputs.schedule, weather, etr_override=etr)
    return ComputedRun(inputs, weather, rows, len(inputs.weather), forecast,
                       engine_stages, cur_date, provisional)


# --------------------------------------------------------------------------- #
# Derivation helpers
# --------------------------------------------------------------------------- #
def _stage_label(cr: ComputedRun, row: dict) -> str:
    idx = row["interval"] - 1
    if 0 <= idx < len(cr.engine_stages):
        return cr.engine_stages[idx].label
    return row.get("stage") or ""


def _clamp01(x: Optional[float]) -> float:
    if x is None:
        return 0.0
    return max(0.0, min(1.0, x))


def build_state(settings: Settings, sample_dir: Optional[Path] = None) -> schemas.StateResponse:
    inputs = make_source(settings, sample_dir=sample_dir).load()
    cr = run_engine(inputs, settings)
    rows, n_actual = cr.rows, cr.n_actual
    weather_by_date = {w["date"]: w for w in cr.weather}
    rows_by_date = {r["date"]: r for r in rows}

    # read-only passthrough: engine stages with their already-computed start GDD/DAP
    stage_infos = []
    for st in cr.engine_stages:
        r = rows_by_date.get(st.date)
        stage_infos.append(schemas.StageInfo(
            label=st.label, date=st.date,
            kind="provisional" if st.label in cr.provisional else "observed",
            gdd=(r["cumgdd"] if r else None), dap=(r["dap"] if r else None)))

    actual_rows = cr.actual_rows
    forecast_rows = cr.forecast_rows
    last_actual_row = actual_rows[-1]
    valid_actuals = [r for r in actual_rows if r["depletion"] is not None]
    today_row = valid_actuals[-1] if valid_actuals else last_actual_row

    today_real = date.today()
    last_actual_date = last_actual_row["date"]
    days_since = (today_real - last_actual_date).days
    stale = days_since > settings.stale_after_days

    today_kind = cr.kind_for(rows.index(today_row), today_row["date"])
    estimated = today_kind == "provisional"

    # ----- today -----
    tw = weather_by_date.get(today_row["date"], {})
    today = schemas.TodayState(
        date=today_row["date"], dap=today_row["dap"], stage=_stage_label(cr, today_row),
        cumgdd=today_row["cumgdd"], kcr=today_row["kcr"], etr=today_row["etr"],
        etc=today_row["etc"], depletion=today_row["depletion"], ad=today_row["ad"],
        should_irrigate=bool(today_row["should_irrigate"]), estimated=estimated,
        weather=schemas.DayWeather(
            tmax=tw.get("tmax"), tmin=tw.get("tmin"), rhmax=tw.get("rhmax"),
            rhmin=tw.get("rhmin"), u2=tw.get("u"), rs=tw.get("rs"), precip=tw.get("precip")))

    # ----- decision -----
    dep, ad = today_row["depletion"], today_row["ad"]
    etc_tail = [r["etc"] for r in actual_rows[-settings.recent_etc_window:] if r["etc"] is not None]
    recent_avg_etc = mean(etc_tail) if etc_tail else None
    should_now = bool(today_row["should_irrigate"])

    days_to_trigger = None
    if should_now:
        days_to_trigger = 0.0
    elif dep is not None and ad is not None and recent_avg_etc and recent_avg_etc > 0:
        days_to_trigger = max(0.0, (ad - dep) / recent_avg_etc)

    projected_trigger_date = today_row["date"] if should_now else None
    if not should_now:
        for r in forecast_rows:
            if r["depletion"] is not None and r["ad"] is not None and r["depletion"] >= r["ad"]:
                projected_trigger_date = r["date"]
                break

    headroom = (ad - dep) if (ad is not None and dep is not None) else None
    recommendation = _recommendation(should_now, days_to_trigger, projected_trigger_date, today_real)
    decision = schemas.Decision(
        should_irrigate_now=should_now,
        days_to_trigger=round(days_to_trigger, 1) if days_to_trigger is not None else None,
        projected_trigger_date=projected_trigger_date,
        recent_avg_etc=round(recent_avg_etc, 3) if recent_avg_etc is not None else None,
        depletion=dep, ad=ad, headroom=headroom, estimated=estimated, recommendation=recommendation)

    # ----- series -----
    series = []
    for i, r in enumerate(rows):
        w = weather_by_date.get(r["date"], {})
        series.append(schemas.SeriesPoint(
            date=r["date"], dap=r["dap"], stage=_stage_label(cr, r),
            depletion=r["depletion"], ad=r["ad"], etc=r["etc"], etr=r["etr"],
            kcr=r["kcr"], applied=r["applied"] or 0.0, precip=w.get("precip"),
            tmax=w.get("tmax"), tmin=w.get("tmin"),
            kind=cr.kind_for(i, r["date"]), is_forecast=i >= n_actual))

    # ----- growth stage -----
    interval = today_row["interval"]
    labels = [sr.label for sr in inputs.stage_rows]
    cur_label = _stage_label(cr, today_row)
    ordinal = labels.index(cur_label) if cur_label in labels else interval - 1
    season_progress = _clamp01((ordinal + _clamp01(today_row["fracint"])) / max(1, len(labels) - 1))
    growth = schemas.GrowthStage(
        stage=cur_label, interval=interval, dap=today_row["dap"], cumgdd=today_row["cumgdd"],
        kcr=today_row["kcr"], progress=_clamp01(today_row["fracint"]),
        season_progress=season_progress, estimated=estimated)

    # ----- season summary (actuals only) -----
    summary = _season_summary(inputs, actual_rows, weather_by_date)

    # ----- schedule readback -----
    sched_entries = []
    for d in sorted(inputs.schedule):
        r = rows_by_date.get(d)
        sched_entries.append(schemas.ScheduleEntry(
            date=d, type=inputs.schedule[d], applied=(r["applied"] if r else 0.0) or 0.0,
            triggered=bool(r["should_irrigate"]) if r else False, is_forecast=d > last_actual_date))

    # ----- alerts -----
    alerts = _alerts(should_now, dep, ad, stale, days_since, projected_trigger_date,
                     last_actual_date, estimated, inputs.warnings)

    site = schemas.Site(
        name=inputs.site.name, season=inputs.site.season, latitude=inputs.site.latitude,
        longitude=inputs.site.longitude, elevation=inputs.site.elevation,
        planting_date=inputs.site.planting_date, reference_crop=inputs.site.reference_crop,
        units_default=inputs.site.units_default, sheet_edit_url=inputs.site.sheet_edit_url,
        demo_mode=inputs.site.demo_mode)
    freshness = schemas.Freshness(
        last_actual_date=last_actual_date, days_since=days_since, stale=stale,
        forecast_through=(forecast_rows[-1]["date"] if forecast_rows else None),
        forecast_source=cr.forecast.source)

    return schemas.StateResponse(
        site=site, freshness=freshness, today=today, decision=decision, series=series,
        stages=stage_infos, growth_stage=growth, season_summary=summary,
        schedule=sched_entries, alerts=alerts, generated_at=datetime.now().isoformat())


def _recommendation(should_now, days_to_trigger, projected_date, today_real) -> str:
    if should_now:
        return "Irrigate today"
    if projected_date is not None:
        x = max(0, (projected_date - today_real).days)
        when = projected_date
    elif days_to_trigger is not None:
        x = int(round(days_to_trigger))
        when = today_real + timedelta(days=x)
    else:
        return "Hold — not enough data to project the next trigger."
    if x == 0:
        return f"Hold — trigger imminent (≈ {when.isoformat()})"
    return f"Hold — trigger in ~{x} day{'s' if x != 1 else ''} (≈ {when.isoformat()})"


def _season_summary(inputs, actual_rows, weather_by_date) -> schemas.SeasonSummary:
    total_etc = sum(r["etc"] for r in actual_rows if r["etc"] is not None)
    irrig = fert = 0.0
    irrig_n = fert_n = 0
    for r in actual_rows:
        applied = r["applied"] or 0.0
        if applied > 0:
            if inputs.schedule.get(r["date"]) == "Fert":
                fert += applied
                fert_n += 1
            else:
                irrig += applied
                irrig_n += 1
    total_rain = sum((weather_by_date.get(r["date"], {}).get("precip") or 0.0) for r in actual_rows)
    effective = 0.0
    for r in actual_rows:
        p = weather_by_date.get(r["date"], {}).get("precip") or 0.0
        effective += max(0.0, p - (r["ro"] or 0.0))
    return schemas.SeasonSummary(
        total_etc=round(total_etc, 1), total_applied_irrig=round(irrig, 1),
        total_applied_fert=round(fert, 1), total_rainfall=round(total_rain, 1),
        effective_rainfall=round(effective, 1), irrigation_events=irrig_n, fertigation_events=fert_n)


def _alerts(should_now, dep, ad, stale, days_since, projected_date,
            last_actual_date, estimated, warnings) -> list[schemas.Alert]:
    alerts: list[schemas.Alert] = []
    if should_now:
        msg = "Irrigation trigger reached"
        if dep is not None and ad is not None:
            msg += f" — depletion {dep:.1f} mm exceeds AD {ad:.1f} mm."
        alerts.append(schemas.Alert(level="critical", code="trigger_reached", message=msg))
    elif projected_date is not None:
        alerts.append(schemas.Alert(
            level="info", code="trigger_projected",
            message=f"Projected trigger on {projected_date.isoformat()} (within forecast window)."))
    if stale:
        alerts.append(schemas.Alert(
            level="warning", code="stale_data",
            message=f"Weather data is {days_since} days old (last actual {last_actual_date.isoformat()})."))
    if estimated:
        alerts.append(schemas.Alert(
            level="info", code="estimated",
            message="Current stage is open — Kcr/ETc and the projection use estimated upcoming "
                    "stage dates, and sharpen as you log the real dates."))
    for w in warnings:
        alerts.append(schemas.Alert(level="info", code="load_warning", message=w))
    return alerts
