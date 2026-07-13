"""Resolve a run selection (zone / crop alias / field) to a Google Sheet id.

This is the promotion of the old `resolve_crop()` global selector. It changes
ONLY which sheet is chosen — never how the engine computes. Precedence:

  1. `zone_id`  → that zone's own sheet_id (the new primary path).
  2. `crop`     → the matching zone in the (given or active) field — the
                  backwards-compatible alias; falls back to the legacy config
                  registry if the store has no such zone yet.
  3. default    → the default-crop zone, else the legacy default sheet.

The corn/sorghum zones are seeded FROM the legacy registry, so a zone lookup and
the legacy `resolve_crop()` return the same sheet_id — that is what keeps
`?crop=corn` and `?zone_id=<corn zone>` byte-identical.
"""
from __future__ import annotations

from typing import Optional

from ..config import DEFAULT_CROP, Settings, resolve_crop
from . import store


def resolve_sheet(
    *,
    zone_id: Optional[str] = None,
    crop: Optional[str] = None,
    field_id: Optional[str] = None,
    settings: Settings,
) -> str:
    """Return the sheet id that should drive the engine for this selection.

    Never returns an arbitrary id: unknown selections degrade to the crop alias
    and finally to the registered default (corn), exactly like the old resolver.
    """
    store.ensure_seeded(settings)

    if zone_id:
        zone = store.get_zone(zone_id, field_id=field_id)
        if zone is not None:
            return zone.sheet_id
        # unknown zone id → fall through to crop/default (never an arbitrary id)

    if crop:
        zone = store.find_zone_by_crop(crop, field_id=field_id)
        if zone is not None:
            return zone.sheet_id
        return resolve_crop(crop, settings)  # legacy alias fallback

    default_zone = store.find_zone_by_crop(DEFAULT_CROP, field_id=field_id)
    if default_zone is not None:
        return default_zone.sheet_id
    return resolve_crop(None, settings)
