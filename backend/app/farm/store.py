"""JSON-backed persistence for the engine-side Field→Zone model.

Same pattern as the Field-Health field store: a single JSON file under
backend/data/ (gitignored), a process lock, atomic writes. Separate file
(farm.json) and separate concept — this holds engine run-selection state
(fields, their zones, the active-field pointer), not satellite polygons.

Migration: `ensure_seeded()` promotes the current setup exactly once — it reads
the existing config crop registry (corn/sorghum → sheet_id) and materializes ONE
Field ("Colby 2026") with TWO zones (a corn zone + a sorghum zone), each carrying
its own sheet_id. The registry is the SEED; from here on zones own the sheet_id.
"""
from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Iterable, Optional

from ..config import CROP_LABELS, Settings, _crop_registry, get_settings
from .schemas import Field, Zone, ZoneCreate

DATA_DIR = Path(__file__).resolve().parents[2] / "data"   # backend/data
STORE = DATA_DIR / "farm.json"                            # tests may monkeypatch this

_lock = threading.RLock()

SEED_FIELD_ID = "field-colby-2026"
SEED_SEASON_YEAR = 2026
SEED_FIELD_NAME = "Colby 2026"


def _empty() -> dict:
    return {"active_field_id": None, "fields": {}}


def _load_raw() -> dict:
    if not STORE.exists():
        return _empty()
    try:
        return json.loads(STORE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _empty()


def _save_raw(data: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(STORE)


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------- #
# migration / seed
# --------------------------------------------------------------------------- #
def ensure_seeded(settings: Optional[Settings] = None) -> None:
    """Materialize the current crop registry into a Field with one zone per crop,
    once. No-op if any field already exists (never clobbers real data)."""
    with _lock:
        data = _load_raw()
        if data.get("fields"):
            return
        s = settings or get_settings()
        zones = [
            Zone(
                id=f"zone-{crop}-{SEED_SEASON_YEAR}",
                name=CROP_LABELS.get(crop, crop.title()),
                crop=crop,
                sheet_id=sheet_id,
                season_year=SEED_SEASON_YEAR,
            )
            for crop, sheet_id in _crop_registry(s).items()
        ]
        field = Field(id=SEED_FIELD_ID, name=SEED_FIELD_NAME, zones=zones)
        _save_raw({"active_field_id": field.id, "fields": {field.id: field.model_dump()}})


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #
def list_fields() -> list[Field]:
    return [Field(**f) for f in _load_raw()["fields"].values()]


def get_field(field_id: str) -> Optional[Field]:
    raw = _load_raw()["fields"].get(field_id)
    return Field(**raw) if raw else None


def active_field_id() -> Optional[str]:
    return _load_raw().get("active_field_id")


def get_active_field() -> Optional[Field]:
    data = _load_raw()
    fid = data.get("active_field_id")
    raw = data["fields"].get(fid) if fid else None
    if raw is None:  # pointer missing/stale — fall back to the first field, if any
        vals = list(data["fields"].values())
        raw = vals[0] if vals else None
    return Field(**raw) if raw else None


def _fields_in_search_order(data: dict, field_id: Optional[str]) -> Iterable[dict]:
    """A specific field if given, else the active field first, then the rest."""
    fields = data["fields"]
    if field_id and field_id in fields:
        return [fields[field_id]]
    active = data.get("active_field_id")
    order: list[dict] = []
    if active and active in fields:
        order.append(fields[active])
    order += [f for fid, f in fields.items() if fid != active]
    return order


def get_zone(zone_id: str, field_id: Optional[str] = None) -> Optional[Zone]:
    data = _load_raw()
    for f in _fields_in_search_order(data, field_id):
        for z in f.get("zones", []):
            if z.get("id") == zone_id:
                return Zone(**z)
    return None


def find_zone_by_crop(crop: str, field_id: Optional[str] = None) -> Optional[Zone]:
    key = (crop or "").strip().lower()
    if not key:
        return None
    data = _load_raw()
    for f in _fields_in_search_order(data, field_id):
        for z in f.get("zones", []):
            if (z.get("crop") or "").strip().lower() == key:
                return Zone(**z)
    return None


# --------------------------------------------------------------------------- #
# writes
# --------------------------------------------------------------------------- #
def set_active_field(field_id: str) -> Optional[Field]:
    with _lock:
        data = _load_raw()
        if field_id not in data["fields"]:
            return None
        data["active_field_id"] = field_id
        _save_raw(data)
        return Field(**data["fields"][field_id])


def create_field(name: str, zones: list[ZoneCreate], *, boundary: Optional[dict] = None,
                 area_acres: Optional[float] = None, meter: Optional[dict] = None,
                 make_active: bool = True) -> Field:
    """Create a Field with >= 1 zone (each zone gets a generated id). Supports the
    multi-field case (several pivots)."""
    field = Field(
        id=_gen_id(), name=name.strip() or "Field", boundary=boundary,
        area_acres=area_acres, meter=meter,
        zones=[Zone(id=_gen_id(), name=z.name, crop=z.crop, sheet_id=z.sheet_id,
                    season_year=z.season_year, boundary=z.boundary, area_acres=z.area_acres)
               for z in zones],
    )
    with _lock:
        data = _load_raw()
        data["fields"][field.id] = field.model_dump()
        if make_active or data.get("active_field_id") is None:
            data["active_field_id"] = field.id
        _save_raw(data)
    return field


# --------------------------------------------------------------------------- #
# field meter (optional, field-level — additive; never affects zone selection)
# --------------------------------------------------------------------------- #
def get_meter(field_id: str) -> Optional[dict]:
    """The field's flow-meter log (readings + area basis). Returns an empty meter
    for a known field with none yet, or None if the field doesn't exist."""
    raw = _load_raw()["fields"].get(field_id)
    if raw is None:
        return None
    return raw.get("meter") or {"readings": [], "area_basis": "field", "area_override": None}


def set_meter(field_id: str, meter: dict) -> bool:
    """Persist the meter on the Field object. Returns False if the field is absent."""
    with _lock:
        data = _load_raw()
        if field_id not in data["fields"]:
            return False
        data["fields"][field_id]["meter"] = meter
        _save_raw(data)
        return True
