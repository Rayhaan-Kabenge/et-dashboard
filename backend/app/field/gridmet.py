"""gridMET reference-ET cross-check — v2 SCAFFOLD ONLY (not wired into the UI).

Point source: uses the field centroid (no key needed). v2 will fetch gridMET
reference ET for cross-checking. v1 returns a typed empty result; wrap external
calls in try/except so failures yield an empty series, never a 500.
"""
from __future__ import annotations

from .schemas import Field


def reference_et(field: Field, start: str, end: str) -> list[dict]:  # v2 stub
    """Return [{date, etr_mm}] for the centroid — empty in v1."""
    try:
        return []  # v2: gridMET request at field.centroid here
    except Exception:
        return []
