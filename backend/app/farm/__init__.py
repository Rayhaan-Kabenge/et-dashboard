"""Engine-side Field→Zone model — the primary object that drives engine runs.

A **Field** is one physical field / irrigation system (e.g. a pivot). It always
contains at least one **Zone**; each Zone carries its own crop and its own
`sheet_id`, and THAT sheet drives the Zone's engine run. Single-crop fields are
the trivial case (one Field, one Zone); split fields are the same structure with
several Zones; multiple pivots are several Fields.

This promotes the old global `?crop=` selector (a crop → sheet_id via the config
crop registry) into a proper Field/Zone model, WITHOUT changing how the engine
computes — only which sheet is selected. It is deliberately separate from the
satellite/polygon Field-Health concept in `app/field/` (they may unify later).
"""
from __future__ import annotations

from . import resolve, store
from .schemas import Field, FieldCreate, FieldsResponse, Zone, ZoneCreate

__all__ = [
    "Field", "FieldCreate", "FieldsResponse", "Zone", "ZoneCreate", "resolve", "store",
]
