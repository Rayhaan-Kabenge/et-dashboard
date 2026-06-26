"""OpenET client (v2) — actual ET + gridMET reference ET for a field polygon.

Raw REST via httpx (no new dep). Isolated: imports only ..config + this package.
Everything is wrapped so a missing key / out-of-coverage / API failure yields a
typed empty result with a note — never a 500.

Request schema verified against the live OpenAPI (https://openet-api.org/openapi.json)
and the docs (https://openet.gitbook.io/docs): POST /raster/timeseries/polygon with
a FLAT [lon,lat,...] `geometry`, `interval`, `model`, `variable`, `reference_et`,
`reducer`, `units`, `file_format`. Auth header is the RAW key (not Bearer).
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Optional

import httpx

from ..config import get_settings
from . import field_store
from .schemas import Field

BASE_URL = "https://openet-api.org"
POLYGON_URL = f"{BASE_URL}/raster/timeseries/polygon"
PROVISIONAL_LATENCY_DAYS = 5     # recent days are provisional
MAX_VERTICES = 300               # simplify overly detailed rings

# OpenET coverage = the western 23 US states. A bbox gate avoids a wasted call when
# the field is clearly outside (e.g. eastern US). Colby/North Platte are well inside.
COVERAGE_BBOX = (-125.0, 25.0, -93.0, 49.5)  # (minLon, minLat, maxLon, maxLat)


class OpenETError(Exception):
    pass


def in_coverage(centroid: list[float]) -> bool:
    lon, lat = centroid[0], centroid[1]
    lo_lon, lo_lat, hi_lon, hi_lat = COVERAGE_BBOX
    return lo_lon <= lon <= hi_lon and lo_lat <= lat <= hi_lat


def _flat_ring(geometry: dict) -> list[float]:
    ring = geometry["coordinates"][0]
    if len(ring) > MAX_VERTICES:  # downsample, keeping the closing vertex
        step = max(1, len(ring) // MAX_VERTICES)
        ring = ring[::step] + [ring[-1]]
    out: list[float] = []
    for pt in ring:
        out.extend([round(float(pt[0]), 6), round(float(pt[1]), 6)])
    return out


def _parse_series(payload, value_hint: str) -> list[dict]:
    """OpenET JSON timeseries -> [{date, mm}]. Flexible about the value key name."""
    rows = payload if isinstance(payload, list) else payload.get("data", payload) if isinstance(payload, dict) else []
    out: list[dict] = []
    if not isinstance(rows, list):
        return out
    for item in rows:
        if not isinstance(item, dict):
            continue
        # date field
        d = item.get("time") or item.get("date") or item.get("Date") or item.get("Time")
        if not d:
            continue
        d = str(d)[:10]
        # value: prefer the variable-named key, else the first numeric non-date field
        val = None
        for k, v in item.items():
            if k.lower() in ("time", "date"):
                continue
            if isinstance(v, (int, float)):
                val = float(v)
                if k.lower() == value_hint.lower():
                    break
        if val is not None:
            out.append({"date": d, "mm": val})
    out.sort(key=lambda r: r["date"])
    return out


class OpenETClient:
    def __init__(self, api_key: Optional[str], timeout: float = 120.0):
        self._key = api_key
        self._timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self._key)

    def timeseries(self, geometry: dict, start: str, end: str, variable: str) -> list[dict]:
        if not self.configured:
            raise OpenETError("OpenET API key not configured (OPENET_API_KEY).")
        body = {
            "date_range": [start, end],
            "interval": "daily",
            "geometry": _flat_ring(geometry),
            "model": "Ensemble",
            "variable": variable,            # "ET" (actual) or "ETr" (gridMET alfalfa ref)
            "reference_et": "gridMET",
            "reducer": "mean",
            "units": "mm",
            "file_format": "JSON",
        }
        try:
            r = httpx.post(POLYGON_URL, json=body, headers={"Authorization": self._key}, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise OpenETError(f"OpenET request failed ({type(exc).__name__})")
        if r.status_code != 200:
            raise OpenETError(f"OpenET {variable} request failed (HTTP {r.status_code}): {r.text[:160]}")
        try:
            return _parse_series(r.json(), variable)
        except (json.JSONDecodeError, ValueError):
            raise OpenETError("OpenET returned an unparseable response.")


# ---------------------------------------------------------------------------
# Cached, incremental service (mirrors indices.py)
# ---------------------------------------------------------------------------
def _cache_file(field_id: str, variable: str):
    return field_store.cache_path(field_id, f"openet_{variable}.json")


def _load_cache(field_id: str, variable: str) -> dict:
    p = _cache_file(field_id, variable)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"points": [], "cov_start": None, "cov_end": None}


def _save_cache(field_id: str, variable: str, data: dict) -> None:
    _cache_file(field_id, variable).write_text(json.dumps(data), encoding="utf-8")


def _series_cached(client: OpenETClient, field: Field, variable: str, start: str, end: str):
    """Return (points, note) for one variable, cached + incremental."""
    cache = _load_cache(field.id, variable)
    by_date = {p["date"]: p for p in cache.get("points", [])}
    cov_start, cov_end = cache.get("cov_start"), cache.get("cov_end")

    gaps: list[tuple[str, str]] = []
    if cov_start is None:
        gaps.append((start, end))
    else:
        if start < cov_start:
            gaps.append((start, min(end, (date.fromisoformat(cov_start) - timedelta(days=1)).isoformat())))
        if end > cov_end:
            gaps.append((max(start, (date.fromisoformat(cov_end) + timedelta(days=1)).isoformat()), end))

    note = None
    fetched = False
    for gs, ge in gaps:
        if gs > ge:
            continue
        try:
            for p in client.timeseries(field.geometry, gs, ge, variable):
                by_date[p["date"]] = p
            fetched = True
        except OpenETError as exc:
            note = str(exc)

    if note is None and (fetched or cov_start is None):
        _save_cache(field.id, variable, {
            "points": sorted(by_date.values(), key=lambda x: x["date"]),
            "cov_start": min(start, cov_start) if cov_start else start,
            "cov_end": max(end, cov_end) if cov_end else end,
        })
    pts = [p for p in sorted(by_date.values(), key=lambda x: x["date"]) if start <= p["date"] <= end]
    return pts, note


def get_et(field: Field, start: str, end: str) -> dict:
    """Actual ET + gridMET reference ET for the field/range.

    Returns {et_actual, etr_gridmet, provisional_from, coverage, note}. Never raises.
    """
    if not in_coverage(field.centroid):
        return {"et_actual": [], "etr_gridmet": [], "provisional_from": None,
                "coverage": "out_of_area",
                "note": "Field is outside OpenET coverage (western 23 US states)."}

    client = OpenETClient(get_settings().openet_api_key)
    if not client.configured:
        return {"et_actual": [], "etr_gridmet": [], "provisional_from": None,
                "coverage": "ok", "note": "Add OPENET_API_KEY to enable the OpenET ET overlay."}

    et_actual, note_a = _series_cached(client, field, "ET", start, end)
    etr, note_b = _series_cached(client, field, "ETr", start, end)
    note = note_a or note_b
    provisional_from = (date.today() - timedelta(days=PROVISIONAL_LATENCY_DAYS)).isoformat()
    return {"et_actual": et_actual, "etr_gridmet": etr, "provisional_from": provisional_from,
            "coverage": "ok", "note": note}
