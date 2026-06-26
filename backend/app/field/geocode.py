"""Server-side OpenStreetMap Nominatim proxy for the Field Health map search.

View-only navigation helper: it lets a user pan/zoom the map toward an area.
It NEVER touches the field store or any engine coordinate. Isolated — imports
nothing from the engine side (only httpx + stdlib).

Nominatim usage policy is handled here so the browser never hits it directly:
a proper identifying User-Agent, ≤1 request/second, a 5 s timeout, and a short
cache for identical queries. Failures and no-results degrade to an empty list.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Policy requires identifying the app + a contact (a stock library UA is not ok).
USER_AGENT = "et-dashboard-field-health/1.0 (+https://github.com/Rayhaan-Kabenge/et-dashboard)"
TIMEOUT = 5.0           # seconds
MIN_INTERVAL = 1.0      # ≤ 1 request / second (Nominatim policy)
CACHE_TTL = 600         # cache identical queries for ~10 min
MAX_RESULTS = 5

_lock = threading.Lock()
_last_call = 0.0
_cache: "dict[str, tuple[float, list[dict]]]" = {}


def _cached(q: str) -> Optional[list]:
    hit = _cache.get(q)
    if hit and (time.time() - hit[0]) < CACHE_TTL:
        return hit[1]
    return None


def _shape(raw: list) -> list:
    out: list = []
    for r in raw[:MAX_RESULTS]:
        try:
            lat = float(r["lat"])
            lon = float(r["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        item = {"display_name": r.get("display_name", ""), "lat": lat, "lon": lon}
        bb = r.get("boundingbox")
        if isinstance(bb, list) and len(bb) == 4:
            try:
                # Nominatim boundingbox is [south, north, west, east] (strings).
                s, n, w, e = (float(x) for x in bb)
                item["bbox"] = [s, n, w, e]
            except (TypeError, ValueError):
                pass
        out.append(item)
    return out


def search(q: str) -> list:
    """Up to 5 {display_name, lat, lon, bbox?} for a free-text query.

    Never raises: a failed request or no matches both return []. Only successful
    responses are cached (so a transient network error can be retried).
    """
    q = (q or "").strip()
    if not q:
        return []
    cached = _cached(q)
    if cached is not None:
        return cached

    global _last_call
    with _lock:  # serialize callers and throttle to ≤1 req/s
        wait = MIN_INTERVAL - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            resp = httpx.get(
                NOMINATIM_URL,
                params={"format": "json", "limit": MAX_RESULTS, "q": q},
                headers={"User-Agent": USER_AGENT},
                timeout=TIMEOUT,
            )
            _last_call = time.time()
            resp.raise_for_status()
            raw = resp.json()
        except Exception:
            _last_call = time.time()
            return []  # not cached — allow a retry

    results = _shape(raw if isinstance(raw, list) else [])
    _cache[q] = (time.time(), results)
    return results
