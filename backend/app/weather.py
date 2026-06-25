"""Forecast fabrication for the projection tail.

Two streams feed the engine:
  * actuals  — the Weather_Daily rows (authoritative balance).
  * forecast — fabricated future days appended after the last actual, used only
               for projecting the trigger date. Re-derived on every load.

Strategy (spec):
  1. Pull a short forecast from Open-Meteo (free, no key) for the site lat/lon.
  2. Per-field fallback: any field the API can't supply persists the mean of the
     last 3 actual days forward.
  3. precip = 0 on forecast days unless the API reports a positive value.

This module fabricates weather dicts ONLY; it computes no ET. compute.py turns the
combined actual+forecast weather into ETr via the engine's pyfao wrapper.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from statistics import mean
from typing import Optional

import httpx

# log-law factor to bring 10 m wind down to a 2 m-equivalent (matches the engine's
# u2 reduction): u2 = u10 * 4.87 / ln(67.8*10 - 5.42)
_WIND_10M_TO_2M = 4.87 / (6.5107)  # ln(672.58) ~= 6.5107  -> 0.748


@dataclass
class ForecastResult:
    days: list[dict]            # fabricated weather dicts, date order
    source: str                 # "open-meteo" | "persistence" | "mixed" | "none"
    note: Optional[str] = None


def _persistence_baseline(actuals: list[dict], n: int = 3) -> dict:
    """Mean of the last n actual days for each weather field (None-safe)."""
    tail = actuals[-n:] if len(actuals) >= 1 else []

    def avg(key, default):
        vals = [w[key] for w in tail if w.get(key) is not None]
        return mean(vals) if vals else default

    return dict(
        tmax=avg("tmax", 30.0), tmin=avg("tmin", 16.0),
        rhmax=avg("rhmax", 80.0), rhmin=avg("rhmin", 40.0),
        u=avg("u", 2.0), rs=avg("rs", 22.0),
    )


def _fetch_open_meteo(lat: float, lon: float, start: date, end: date,
                      url: str, timeout: float) -> dict[date, dict]:
    """Return {date: {tmax,tmin,precip,rs,rhmax,rhmin,u}} from Open-Meteo.

    Raises on any HTTP/parse failure so the caller can fall back to persistence.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum",
        "hourly": "relative_humidity_2m,wind_speed_10m",
        "wind_speed_unit": "ms",
        "timezone": "auto",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    resp = httpx.get(url, params=params, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()

    out: dict[date, dict] = {}
    daily = data.get("daily", {})
    dts = daily.get("time", [])
    for i, ds in enumerate(dts):
        d = date.fromisoformat(ds)
        out[d] = dict(
            tmax=_at(daily.get("temperature_2m_max"), i),
            tmin=_at(daily.get("temperature_2m_min"), i),
            precip=_at(daily.get("precipitation_sum"), i),
            rs=_at(daily.get("shortwave_radiation_sum"), i),  # MJ/m2/day already
            rhmax=None, rhmin=None, u=None,
        )

    # aggregate hourly RH (max/min) and wind (mean) per calendar day
    hourly = data.get("hourly", {})
    htimes = hourly.get("time", [])
    rh = hourly.get("relative_humidity_2m", [])
    ws = hourly.get("wind_speed_10m", [])
    by_day_rh: dict[date, list] = {}
    by_day_ws: dict[date, list] = {}
    for i, ts in enumerate(htimes):
        d = date.fromisoformat(ts[:10])
        if rh and i < len(rh) and rh[i] is not None:
            by_day_rh.setdefault(d, []).append(rh[i])
        if ws and i < len(ws) and ws[i] is not None:
            by_day_ws.setdefault(d, []).append(ws[i])
    for d, rec in out.items():
        if d in by_day_rh and by_day_rh[d]:
            rec["rhmax"] = max(by_day_rh[d])
            rec["rhmin"] = min(by_day_rh[d])
        if d in by_day_ws and by_day_ws[d]:
            rec["u"] = mean(by_day_ws[d]) * _WIND_10M_TO_2M
    return out


def _at(seq, i):
    if seq is None or i >= len(seq):
        return None
    return seq[i]


def fabricate_forecast(
    actuals: list[dict],
    *,
    lat: Optional[float],
    lon: Optional[float],
    season_year: int,
    n_days: int,
    url: str,
    timeout: float,
) -> ForecastResult:
    """Build `n_days` forecast weather dicts to append after the last actual."""
    if not actuals or n_days <= 0:
        return ForecastResult(days=[], source="none")

    last = actuals[-1]["date"]
    forecast_dates = [last + timedelta(days=i) for i in range(1, n_days + 1)]
    baseline = _persistence_baseline(actuals)

    api: dict[date, dict] = {}
    source = "persistence"
    note = None
    if lat is not None and lon is not None:
        # Open-Meteo serves ~16 forecast days; request only the in-range window and
        # let persistence cover the tail out to the (longer) horizon.
        today = date.today()
        api_start = max(forecast_dates[0], today)
        api_end = min(forecast_dates[-1], today + timedelta(days=15))
        if api_end >= api_start:
            try:
                api = _fetch_open_meteo(lat, lon, api_start, api_end, url, timeout)
                source = "open-meteo"
            except Exception as exc:  # network/parse — degrade gracefully
                note = f"Open-Meteo unavailable ({type(exc).__name__}); using 3-day persistence."
                api = {}
                source = "persistence"
    else:
        note = "No longitude configured; using 3-day persistence for the forecast."

    used_api = used_fallback = False
    days: list[dict] = []
    for d in forecast_dates:
        rec = dict(baseline)  # start from persistence
        rec["precip"] = 0.0   # assume dry unless API says otherwise
        a = api.get(d)
        if a:
            for k in ("tmax", "tmin", "rs", "rhmax", "rhmin", "u"):
                if a.get(k) is not None:
                    rec[k] = a[k]
                    used_api = True
                else:
                    used_fallback = True
            if a.get("precip") is not None and a["precip"] > 0:
                rec["precip"] = float(a["precip"])
        else:
            used_fallback = True
        rec["date"] = d
        rec["doy"] = (d - date(d.year - 1, 12, 31)).days
        days.append(rec)

    if source == "open-meteo" and used_api and used_fallback:
        source = "mixed"
    return ForecastResult(days=days, source=source, note=note)
