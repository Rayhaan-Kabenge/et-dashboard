"""Index time-series service: cache + incremental fetch around the Sentinel client.

Cache per (field_id, index) under backend/data/cache/<field>/indices_<INDEX>.json:
all observed points + the covered date range. A request fetches only the date gaps
not already covered (most reloads add nothing — S2 revisit ~5 days + cloud gaps).
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Optional

from ..config import get_settings
from . import field_store
from .schemas import Field
from .sentinel import SentinelClient, SentinelError

MIN_VALID_FRACTION = 0.2


def _client() -> SentinelClient:
    s = get_settings()
    return SentinelClient(s.sh_client_id, s.sh_client_secret)


def _cache_file(field_id: str, index: str):
    return field_store.cache_path(field_id, f"indices_{index}.json")


def _load_cache(field_id: str, index: str) -> dict:
    p = _cache_file(field_id, index)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"points": [], "cov_start": None, "cov_end": None}


def _save_cache(field_id: str, index: str, data: dict) -> None:
    _cache_file(field_id, index).write_text(json.dumps(data), encoding="utf-8")


def _d(s: str) -> date:
    return date.fromisoformat(s)


def get_index_series(field: Field, index: str, start: str, end: str):
    """Return (points, last_observation, note). Cached + incremental; degrades to
    an empty series with a note on any imagery-service failure (never raises)."""
    index = (index or "NDRE").upper()
    if index not in ("NDRE", "NDVI"):
        index = "NDRE"

    cache = _load_cache(field.id, index)
    by_date: dict[str, dict] = {p["date"]: p for p in cache.get("points", [])}
    cov_start, cov_end = cache.get("cov_start"), cache.get("cov_end")

    # only fetch the date gaps not already covered
    gaps: list[tuple[str, str]] = []
    if cov_start is None or cov_end is None:
        gaps.append((start, end))
    else:
        if _d(start) < _d(cov_start):
            gaps.append((start, min(end, (_d(cov_start) - timedelta(days=1)).isoformat())))
        if _d(end) > _d(cov_end):
            gaps.append((max(start, (_d(cov_end) + timedelta(days=1)).isoformat()), end))

    note: Optional[str] = None
    fetched_any = False
    for gstart, gend in gaps:
        if _d(gstart) > _d(gend):
            continue
        try:
            new_points = _client().statistics(field.geometry, gstart, gend, index)
            for p in new_points:
                by_date[p["date"]] = p
            fetched_any = True
        except SentinelError as exc:
            note = str(exc)

    if fetched_any or cov_start is None:
        new_cov_start = min(start, cov_start) if cov_start else start
        new_cov_end = max(end, cov_end) if cov_end else end
        # only widen coverage for gaps we actually fetched without error
        if note is None:
            cache = {
                "points": sorted(by_date.values(), key=lambda x: x["date"]),
                "cov_start": new_cov_start,
                "cov_end": new_cov_end,
            }
            _save_cache(field.id, index, cache)

    points = [
        p for p in sorted(by_date.values(), key=lambda x: x["date"])
        if start <= p["date"] <= end and p["valid_fraction"] >= MIN_VALID_FRACTION
    ]
    last_obs = points[-1]["date"] if points else None
    if not points and note is None:
        note = "No cloud-free imagery in this range."
    return points, last_obs, note
