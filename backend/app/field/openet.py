"""OpenET actual-ET overlay — v2 SCAFFOLD ONLY (not wired into the UI).

v2 will call the OpenET API (OPENET_API_KEY) for the field geometry and return an
actual-ET time series to overlay on the index timeline. v1 returns a typed empty
result; every external call must be wrapped in try/except so a failure yields an
empty series, never a 500.
"""
from __future__ import annotations

from .schemas import Field


def actual_et(field: Field, start: str, end: str) -> list[dict]:  # v2 stub
    """Return [{date, et_mm}] — empty in v1."""
    try:
        return []  # v2: OpenET request here
    except Exception:
        return []
