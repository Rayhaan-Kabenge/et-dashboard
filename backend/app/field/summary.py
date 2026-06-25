"""AI field-summary — v1 STUB. v2 will assemble computed index/ET values and call
Anthropic (ANTHROPIC_API_KEY) to produce a plain-language summary.

Kept as a seam so v2 drops in without touching the router/UI.
"""
from __future__ import annotations

from .schemas import Field, SummaryResponse


def build_summary(field: Field) -> SummaryResponse:  # v1 stub
    return SummaryResponse(status="stub", message="Plain-language summary coming soon.")
